import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Email provider. Pluggable like lib/drive.ts / lib/video-provider.ts: the rest
 * of the app calls `sendPersonalizedEmails()` and never touches SMTP details, so
 * swapping Zoho for Resend/SES later is a one-file change.
 *
 * Config comes from env (never committed):
 *   EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS,
 *   EMAIL_FROM_NAME, EMAIL_PLATFORM_URL
 */

export type EmailRecipient = {
  email: string;
  name: string;
  studentCode?: string | null;
};

export type SendSummary = {
  sent: number;
  failed: { email: string; reason: string }[];
  skipped: { email: string; reason: string }[];
};

/** Max recipients handled in one call — guards against runaway sends. */
export const MAX_RECIPIENTS_PER_SEND = 500;
/** How many messages to send concurrently (matches the transporter pool). */
const CONCURRENCY = 3;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.EMAIL_SMTP_HOST &&
      process.env.EMAIL_SMTP_USER &&
      process.env.EMAIL_SMTP_PASS,
  );
}

export function platformUrl(): string {
  return (
    process.env.EMAIL_PLATFORM_URL ||
    process.env.AUTH_URL ||
    "https://videos.skillspark.study"
  );
}

let cached: Transporter | null = null;
function transporter(): Transporter {
  if (cached) return cached;
  const port = Number(process.env.EMAIL_SMTP_PORT || "465");
  cached = nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: {
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASS,
    },
    // Reuse a small pool of connections instead of a fresh TLS handshake per
    // message — far faster for multi-recipient sends.
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    // Hard timeouts so a slow/blocked network (e.g. a host that firewalls the
    // SMTP port) fails fast and is reported, instead of hanging the request.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 25_000,
  });
  return cached;
}

function fromHeader(): string {
  const name = process.env.EMAIL_FROM_NAME?.trim();
  const addr = process.env.EMAIL_SMTP_USER || "";
  return name ? `"${name.replace(/"/g, "")}" <${addr}>` : addr;
}

function replyToAddress(): string {
  return process.env.EMAIL_REPLY_TO?.trim() || process.env.EMAIL_SMTP_USER || "";
}

/** Fill {{placeholders}} for one recipient. Unknown tokens are left as-is. */
export function renderTemplate(tpl: string, r: EmailRecipient): string {
  const first = r.name.trim().split(/\s+/)[0] || r.name;
  const vars: Record<string, string> = {
    name: r.name,
    firstName: first,
    email: r.email,
    studentCode: r.studentCode ?? "",
    platformUrl: platformUrl(),
  };
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    key in vars ? vars[key] : m,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal text -> HTML: escape, linkify bare URLs, newlines -> <br>. */
function textToHtml(text: string): string {
  const escaped = escapeHtml(text);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${linked.replace(/\n/g, "<br>")}</div>`;
}

/**
 * Send an individually-addressed copy to each recipient (never a shared To/CC —
 * addresses are not leaked between students). Subject/body are templates; each
 * copy gets its placeholders resolved for that student. Invalid/empty emails are
 * reported in `skipped`; SMTP failures in `failed`. Deduped by lowercased email.
 */
export async function sendPersonalizedEmails(
  recipients: EmailRecipient[],
  subjectTpl: string,
  bodyTpl: string,
): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, failed: [], skipped: [] };

  if (!isEmailConfigured()) {
    return {
      sent: 0,
      failed: [],
      skipped: recipients.map((r) => ({ email: r.email, reason: "email not configured" })),
    };
  }

  // Dedupe + validate.
  const seen = new Set<string>();
  const valid: EmailRecipient[] = [];
  for (const r of recipients) {
    const email = (r.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      summary.skipped.push({ email: r.email || "(blank)", reason: "invalid email" });
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push({ ...r, email });
  }

  if (valid.length > MAX_RECIPIENTS_PER_SEND) {
    for (const r of valid.slice(MAX_RECIPIENTS_PER_SEND)) {
      summary.skipped.push({ email: r.email, reason: `over ${MAX_RECIPIENTS_PER_SEND}-recipient cap` });
    }
    valid.length = MAX_RECIPIENTS_PER_SEND;
  }

  const from = fromHeader();
  const replyTo = replyToAddress();
  const unsubscribe = `<mailto:${replyTo}?subject=unsubscribe>`;
  const tx = transporter();

  // Small concurrency pool over pooled connections. One personalized copy each
  // (not a big BCC), From aligned to the authenticating domain, plus Reply-To
  // and List-Unsubscribe headers — keeps bulk mail out of spam alongside
  // domain-level SPF/DKIM/DMARC. Connection reuse + timeouts (see transporter)
  // keep it fast and prevent the request hanging on a slow/blocked network.
  let cursor = 0;
  async function worker() {
    while (cursor < valid.length) {
      const r = valid[cursor++];
      const subject = renderTemplate(subjectTpl, r).replace(/\s+/g, " ").trim();
      const text = renderTemplate(bodyTpl, r);
      try {
        await tx.sendMail({
          from,
          to: r.email,
          replyTo,
          subject,
          text,
          html: textToHtml(text),
          headers: { "List-Unsubscribe": unsubscribe },
        });
        summary.sent++;
      } catch (e: any) {
        summary.failed.push({ email: r.email, reason: e?.message ? String(e.message).slice(0, 200) : "send failed" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, valid.length) }, worker));

  return summary;
}

/** Verify SMTP credentials/connection without sending. */
export async function verifyEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) return { ok: false, error: "email not configured" };
  try {
    await transporter().verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : "verify failed" };
  }
}

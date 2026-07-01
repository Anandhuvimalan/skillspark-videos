import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { marked } from "marked";

// Admin templates are Markdown: **bold**, ### headings, > quotes, 1. lists,
// [links](url) and bare URLs. `breaks: true` turns single newlines into <br>
// so pasted text keeps its line breaks without needing double spacing.
marked.setOptions({ gfm: true, breaks: true });

/**
 * Email provider. Pluggable like lib/drive.ts / lib/video-provider.ts: the rest
 * of the app calls `sendPersonalizedEmails()` and never touches transport
 * details.
 *
 * Two transports, chosen automatically:
 *   1. ZeptoMail HTTP API (PREFERRED) — Zoho's transactional email over HTTPS.
 *      Works on hosts that firewall SMTP ports (e.g. Railway). Config:
 *        ZEPTOMAIL_TOKEN, ZEPTOMAIL_API_URL, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME
 *   2. SMTP (nodemailer) — fallback for local/dev where SMTP isn't blocked.
 *        EMAIL_SMTP_HOST/PORT/USER/PASS, EMAIL_FROM_NAME
 *
 * If a ZeptoMail token is present it wins; otherwise SMTP is used.
 * Config comes from env (never committed).
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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---- config ----

type ZeptoConfig = {
  token: string;
  url: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
};

function zeptoConfig(): ZeptoConfig | null {
  const token = process.env.ZEPTOMAIL_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    url: process.env.ZEPTOMAIL_API_URL?.trim() || "https://api.zeptomail.in/v1.1/email",
    fromAddress: process.env.EMAIL_FROM_ADDRESS?.trim() || process.env.EMAIL_SMTP_USER || "",
    fromName: process.env.EMAIL_FROM_NAME?.trim() || "SkillSpark",
    replyTo: replyToAddress(),
  };
}

function smtpConfigured(): boolean {
  return Boolean(
    process.env.EMAIL_SMTP_HOST &&
      process.env.EMAIL_SMTP_USER &&
      process.env.EMAIL_SMTP_PASS,
  );
}

export function isEmailConfigured(): boolean {
  return Boolean(zeptoConfig()) || smtpConfigured();
}

export function platformUrl(): string {
  return (
    process.env.EMAIL_PLATFORM_URL ||
    process.env.AUTH_URL ||
    "https://videos.skillspark.study"
  );
}

function replyToAddress(): string {
  return process.env.EMAIL_REPLY_TO?.trim() || process.env.EMAIL_SMTP_USER || process.env.EMAIL_FROM_ADDRESS?.trim() || "";
}

// ---- SMTP transport (fallback) ----

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
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 25_000,
  });
  return cached;
}

function smtpFromHeader(): string {
  const name = process.env.EMAIL_FROM_NAME?.trim();
  const addr = process.env.EMAIL_SMTP_USER || "";
  return name ? `"${name.replace(/"/g, "")}" <${addr}>` : addr;
}

// ---- ZeptoMail transport (preferred; HTTPS, not blocked by Railway) ----

async function sendViaZepto(
  cfg: ZeptoConfig,
  r: EmailRecipient,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  const auth = cfg.token.startsWith("Zoho-enczapikey")
    ? cfg.token
    : `Zoho-enczapikey ${cfg.token}`;
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: { address: cfg.fromAddress, name: cfg.fromName },
      to: [{ email_address: { address: r.email, name: r.name } }],
      ...(cfg.replyTo ? { reply_to: [{ address: cfg.replyTo }] } : {}),
      subject,
      htmlbody: html,
      textbody: text,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j: any = await res.json();
      detail =
        j?.message ||
        j?.error?.message ||
        j?.error?.details?.[0]?.message ||
        JSON.stringify(j);
    } catch {
      /* keep HTTP status */
    }
    throw new Error(String(detail).slice(0, 200));
  }
}

// ---- templating ----

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

/** Render the Markdown body to HTML, wrapped in a mail-friendly container. */
function markdownToHtml(md: string): string {
  const inner = marked.parse(md, { async: false }) as string;
  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${inner}</div>`;
}

/** Best-effort plain-text version for the text/plain part: drop Markdown
 *  markers so `**bold**` etc. don't show their literal asterisks. */
function markdownToPlain(md: string): string {
  return md
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s{0,3}>\s?/gm, "") // blockquotes
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/__(.+?)__/g, "$1") // __bold__
    .replace(/`([^`]+)`/g, "$1") // `code`
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)") // [text](url)
    .replace(/^\s{0,3}[-*+]\s+/gm, "• ") // bullets
    .trim();
}

// ---- public send ----

/**
 * Send an individually-addressed copy to each recipient (never a shared To/CC —
 * addresses are not leaked between students). Subject/body are templates; each
 * copy gets its placeholders resolved for that student. Invalid/empty emails are
 * reported in `skipped`; transport failures in `failed`. Deduped by lowercased
 * email. Uses ZeptoMail HTTP if configured, else SMTP.
 */
export async function sendPersonalizedEmails(
  recipients: EmailRecipient[],
  subjectTpl: string,
  bodyTpl: string,
): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, failed: [], skipped: [] };

  const zepto = zeptoConfig();
  if (!zepto && !smtpConfigured()) {
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

  // HTTP can safely run more in parallel than pooled SMTP connections.
  const concurrency = zepto ? 6 : 3;
  const from = zepto ? "" : smtpFromHeader();
  const replyTo = replyToAddress();
  const unsubscribe = `<mailto:${replyTo}?subject=unsubscribe>`;
  const tx = zepto ? null : transporter();

  // One personalized copy each (not a big BCC). Deliverability rests on
  // domain-level SPF/DKIM/DMARC (verified in ZeptoMail / DNS).
  let cursor = 0;
  async function worker() {
    while (cursor < valid.length) {
      const r = valid[cursor++];
      const subject = renderTemplate(subjectTpl, r).replace(/\s+/g, " ").trim();
      const rendered = renderTemplate(bodyTpl, r);
      const text = markdownToPlain(rendered);
      const html = markdownToHtml(rendered);
      try {
        if (zepto) {
          await sendViaZepto(zepto, r, subject, text, html);
        } else {
          await tx!.sendMail({
            from,
            to: r.email,
            replyTo,
            subject,
            text,
            html,
            headers: { "List-Unsubscribe": unsubscribe },
          });
        }
        summary.sent++;
      } catch (e: any) {
        summary.failed.push({ email: r.email, reason: e?.message ? String(e.message).slice(0, 200) : "send failed" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, valid.length) }, worker));

  return summary;
}

/** Verify the transport without sending a real message (best-effort). */
export async function verifyEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  const zepto = zeptoConfig();
  if (zepto) {
    // No cheap no-op verify on the HTTP API; treat a present token + from as OK.
    if (!zepto.fromAddress) return { ok: false, error: "EMAIL_FROM_ADDRESS not set" };
    return { ok: true };
  }
  if (!smtpConfigured()) return { ok: false, error: "email not configured" };
  try {
    await transporter().verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : "verify failed" };
  }
}

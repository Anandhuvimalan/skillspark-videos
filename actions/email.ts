"use server";

import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import {
  emailContentSchema,
  emailToStudentsSchema,
  emailToBatchesSchema,
} from "@/lib/validations";
import {
  sendPersonalizedEmails,
  isEmailConfigured,
  type EmailRecipient,
  type SendSummary,
} from "@/lib/email";
import { bad, withAdminD, type RD } from "./_shared";

export type EmailResult = SendSummary & { recipients: number };

const DEFAULT_KEY = "default";

const FALLBACK_SUBJECT = "Access your SkillSpark courses";
const FALLBACK_BODY = `Hi {{name}},

Your SkillSpark learning account is ready.

How to access your content:
1. Go to {{platformUrl}}
2. Click "Sign in with Google" and use THIS email address ({{email}}).
3. Your assigned courses appear on your dashboard.

If you can't sign in, reply to this email and we'll help.

— SkillSpark Academic Coordinator`;

/** Load the admin-editable default template (seeded row, else a built-in). */
export async function getDefaultEmailTemplate(): Promise<{ subject: string; body: string }> {
  const row = await prisma.emailTemplate.findUnique({ where: { key: DEFAULT_KEY } });
  return {
    subject: row?.subject ?? FALLBACK_SUBJECT,
    body: row?.body ?? FALLBACK_BODY,
  };
}

/** Persist the default template so future composers prefill with it. */
export async function saveDefaultEmailTemplate(input: unknown): Promise<RD<{ ok: true }>> {
  return withAdminD(async (admin) => {
    const parsed = emailContentSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    await prisma.emailTemplate.upsert({
      where: { key: DEFAULT_KEY },
      update: { subject: parsed.data.subject, body: parsed.data.body },
      create: { key: DEFAULT_KEY, subject: parsed.data.subject, body: parsed.data.body },
    });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "EMAIL_TEMPLATE_UPDATED", entityType: "EmailTemplate", entityId: DEFAULT_KEY,
    });
    return { ok: true, data: { ok: true } };
  });
}

/** Active + non-expired students are the only ones we email (they can log in). */
function activeStudentWhere(extra: Record<string, unknown>) {
  const now = new Date();
  return {
    ...extra,
    status: "active",
    accessStartDate: { lte: now },
    accessEndDate: { gte: now },
  };
}

async function deliver(
  actor: { id: string; email: string },
  recipients: EmailRecipient[],
  subject: string,
  body: string,
  audit: { source: string; extra?: Record<string, unknown> },
): Promise<RD<EmailResult>> {
  if (!isEmailConfigured()) return bad("email is not configured on the server");
  if (recipients.length === 0) return bad("no eligible active recipients");

  const summary = await sendPersonalizedEmails(recipients, subject, body);

  await createAuditLog({
    actorId: actor.id, actorEmail: actor.email, actorType: "admin",
    action: "EMAIL_SENT", entityType: "Student",
    newValue: {
      source: audit.source,
      subject,
      recipients: recipients.length,
      sent: summary.sent,
      failed: summary.failed.length,
      skipped: summary.skipped.length,
      ...audit.extra,
    },
  });

  return { ok: true, data: { ...summary, recipients: recipients.length } };
}

/** Email a hand-picked set of students (from the Students page selection). */
export async function sendEmailToStudents(input: unknown): Promise<RD<EmailResult>> {
  return withAdminD(async (admin) => {
    const parsed = emailToStudentsSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const { studentIds, subject, body } = parsed.data;

    const students = await prisma.student.findMany({
      where: activeStudentWhere({ id: { in: studentIds } }),
      select: { email: true, name: true, studentCode: true },
    });
    return deliver(admin, students, subject, body, {
      source: "students-page",
      extra: { selected: studentIds.length },
    });
  });
}

/** Email everyone (active, non-expired) across one or more batches. */
export async function sendEmailToBatches(input: unknown): Promise<RD<EmailResult>> {
  return withAdminD(async (admin) => {
    const parsed = emailToBatchesSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const { batchIds, subject, body } = parsed.data;

    const students = await prisma.student.findMany({
      where: activeStudentWhere({ studentBatches: { some: { batchId: { in: batchIds } } } }),
      select: { email: true, name: true, studentCode: true },
    });
    return deliver(admin, students, subject, body, {
      source: "batch-page",
      extra: { batches: batchIds.length },
    });
  });
}

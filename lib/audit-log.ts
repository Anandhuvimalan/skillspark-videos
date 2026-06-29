import { prisma } from "@/lib/db";
import { headers } from "next/headers";

// Schema stores actorType as a String now (no enum). Mirror the runtime values here.
export type ActorType = "admin" | "student" | "system";

export type AuditAction =
  // Student
  | "STUDENT_CREATED"
  | "STUDENT_UPDATED"
  | "STUDENT_DELETED"
  | "STUDENT_BLOCKED"
  | "STUDENT_ACTIVATED"
  | "STUDENT_ACCESS_DATES_CHANGED"
  | "STUDENT_BATCH_CHANGED"
  // Batch
  | "BATCH_CREATED"
  | "BATCH_UPDATED"
  | "BATCH_DELETED"
  // Course
  | "COURSE_CREATED"
  | "COURSE_UPDATED"
  | "COURSE_DELETED"
  | "COURSE_ACTIVATED"
  | "COURSE_INACTIVATED"
  // Batch membership + batch courses (the only access paths)
  | "STUDENT_BATCH_ASSIGNED"
  | "STUDENT_BATCH_REMOVED"
  | "BATCH_COURSE_ASSIGNED"
  | "BATCH_COURSE_REMOVED"
  | "BULK_ENROLLMENT_CREATED"
  | "BULK_STUDENTS_CREATED"
  | "BULK_BATCHES_CREATED"
  | "BULK_COURSES_CREATED"
  | "BULK_STUDENTS_ADDED_TO_BATCH"
  | "BULK_STUDENTS_REMOVED_FROM_BATCH"
  | "BULK_STUDENTS_BLOCKED"
  | "BULK_STUDENTS_ACTIVATED"
  | "BULK_STUDENTS_END_DATE_CHANGED"
  | "BULK_STUDENTS_DELETED"
  // Content
  | "MODULE_CREATED"
  | "MODULE_UPDATED"
  | "MODULE_DELETED"
  | "MODULE_REORDERED"
  | "VIDEO_CREATED"
  | "VIDEO_UPDATED"
  | "VIDEO_DELETED"
  | "VIDEO_REORDERED"
  | "VIDEO_ACTIVATED"
  | "VIDEO_INACTIVATED"
  | "VIDEO_DURATION_FETCHED"
  | "NOTE_CREATED"
  | "NOTE_UPDATED"
  | "NOTE_DELETED"
  | "NOTE_DOWNLOAD_ENABLED"
  | "NOTE_DOWNLOAD_DISABLED"
  // Auth/security
  | "ADMIN_LOGIN"
  | "STUDENT_LOGIN"
  | "LOGIN_DENIED_UNREGISTERED_EMAIL"
  | "LOGIN_DENIED_BLOCKED_STUDENT"
  | "LOGIN_DENIED_BLOCKED_ADMIN"
  | "LOGIN_DENIED_EXPIRED_STUDENT"
  | "UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT"
  | "UNAUTHORIZED_COURSE_ACCESS_ATTEMPT"
  | "UNAUTHORIZED_VIDEO_ACCESS_ATTEMPT"
  | "UNAUTHORIZED_NOTE_ACCESS_ATTEMPT";

export type CreateAuditLogInput = {
  actorId?: string | null;
  actorEmail?: string | null;
  actorType: ActorType;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const SENSITIVE_FIELDS = new Set([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "id_token",
  "access_token",
  "refresh_token",
  "secret",
  "clientSecret",
  "AUTH_SECRET",
]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_FIELDS.has(k) ? "[REDACTED]" : redact(v);
  }
  return out;
}

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(redact(value));
  } catch {
    return null;
  }
}

async function readRequestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null;
    const ua = h.get("user-agent") || null;
    return { ipAddress: ip, userAgent: ua };
  } catch {
    // headers() throws outside a request scope (e.g. server boot, seed). Skip.
    return { ipAddress: null, userAgent: null };
  }
}

export async function createAuditLog(input: CreateAuditLogInput): Promise<void> {
  const meta = await readRequestMeta();
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        oldValue: safeStringify(input.oldValue),
        newValue: safeStringify(input.newValue),
        ipAddress: input.ipAddress ?? meta.ipAddress,
        userAgent: input.userAgent ?? meta.userAgent,
      },
    });
  } catch (err) {
    // Audit logging must never break the user flow.
    console.error("[audit-log] failed to write", err);
  }
}

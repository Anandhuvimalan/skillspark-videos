"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog, type AuditAction } from "@/lib/audit-log";
import {
  parseBulkStudents,
  parseBatchStudents,
  parseBulkBatches,
  parseBulkCourses,
  parseIdentifierList,
} from "@/lib/bulk";
import { bulkActionSchema, dateSchema, idSchema } from "@/lib/validations";
import { sendPersonalizedEmails, isEmailConfigured } from "@/lib/email";
import { z } from "zod";
import * as XLSX from "xlsx";
import { bad, withAdminD, type RD } from "./_shared";
import { CATALOG_TAGS } from "@/lib/catalog-cache";

type R<T> = RD<T>;

const MAX_TEXT_LEN = 200_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Reads the pasted `text` plus an optional uploaded `file`, returning one text
 * blob for the row parsers. Excel files (.xlsx/.xls) are converted to
 * TAB-separated text (the first sheet) so multi-word cells like
 * "KLM 2606 1282 Seethal U" stay in one column; CSV/TXT are read as-is.
 */
async function readFormText(formData: FormData): Promise<string | { error: string }> {
  let text = String(formData.get("text") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: "file exceeds 5 MB" };
    const name = file.name.toLowerCase();
    const isExcel =
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      file.type.includes("spreadsheetml") ||
      file.type.includes("ms-excel");
    let fileText: string;
    if (isExcel) {
      try {
        const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        fileText = sheet ? XLSX.utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false }) : "";
      } catch {
        return { error: "couldn't read that Excel file" };
      }
    } else {
      fileText = await file.text();
    }
    text = text ? `${text}\n${fileText}` : fileText;
  }
  return text;
}

// ============================================================
// Flow 1: add students to an already-set-up batch
//   batchId + paste of `name,email[,studentCode]` (or bare emails)
// ============================================================
const batchStudentsArgs = z.object({
  batchId: idSchema,
  text: z.string().min(1).max(MAX_TEXT_LEN),
  defaultStartDate: dateSchema,
  defaultEndDate: dateSchema,
});

export async function bulkAddStudentsToBatch(
  formData: FormData,
): Promise<R<{ created: number; addedExisting: number; skipped: number; coursesAssigned: number; emailed: number; failed: { line: number; reason: string }[] }>> {
  return withAdminD(async (admin) => {
    const text = await readFormText(formData);
    if (typeof text !== "string") return bad(text.error);
    if (!text.trim()) return bad("no input provided");

    // batchId comes from a dropdown that defaults to "" — give a clear message
    // rather than Zod's generic "String must contain at least 1 character(s)".
    if (!String(formData.get("batchId") ?? "").trim()) return bad("pick a batch first");

    const parsed = batchStudentsArgs.safeParse({
      batchId: formData.get("batchId"),
      text,
      defaultStartDate: formData.get("defaultStartDate"),
      defaultEndDate: formData.get("defaultEndDate"),
    });
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    if (parsed.data.defaultEndDate < parsed.data.defaultStartDate)
      return bad("endDate before startDate");

    const batch = await prisma.batch.findUnique({ where: { id: parsed.data.batchId }, select: { id: true } });
    if (!batch) return bad("batch not found");

    // Optionally assign the picked courses to this batch (students inherit them).
    // Only genuinely-new assignments are inserted and audited; already-assigned
    // courses are left untouched so re-running the form is a no-op for them.
    const applyCourseIds = formData.getAll("applyCourseIds").map(String).filter(Boolean);
    let coursesAssigned = 0;
    if (applyCourseIds.length) {
      const [validCourses, already] = await Promise.all([
        prisma.course.findMany({ where: { id: { in: applyCourseIds } }, select: { id: true } }),
        prisma.batchCourse.findMany({
          where: { batchId: batch.id, courseId: { in: applyCourseIds } },
          select: { courseId: true },
        }),
      ]);
      const validIds = new Set(validCourses.map((c) => c.id));
      const alreadySet = new Set(already.map((b) => b.courseId));
      const toAdd = applyCourseIds.filter((c) => validIds.has(c) && !alreadySet.has(c));
      if (toAdd.length) {
        await prisma.batchCourse.createMany({
          data: toAdd.map((courseId) => ({ batchId: batch.id, courseId })),
          skipDuplicates: true,
        });
        for (const courseId of toAdd) {
          await createAuditLog({
            actorId: admin.id, actorEmail: admin.email, actorType: "admin",
            action: "BATCH_COURSE_ASSIGNED", entityType: "Batch", entityId: batch.id,
            newValue: { courseId, source: "bulk-add-students" },
          });
        }
        coursesAssigned = toAdd.length;
        revalidateTag(CATALOG_TAGS.batches);
      }
    }

    const { rows: rawRows, errors } = parseBatchStudents(parsed.data.text);
    const failed = errors.map((e) => ({ line: e.line, reason: e.reason }));
    let skipped = 0;

    // Dedupe within the input by email AND studentCode (first wins).
    const seenEmails = new Set<string>();
    const seenCodes = new Set<string>();
    const rows = rawRows.filter((r) => {
      if (seenEmails.has(r.email) || seenCodes.has(r.studentCode)) { skipped++; return false; }
      seenEmails.add(r.email);
      seenCodes.add(r.studentCode);
      return true;
    });

    // Dedup against the DB: a row already "seen" (same email OR same admin id)
    // is reused, never recreated — so re-uploading the same file adds only the
    // genuinely new students.
    const existing = rows.length
      ? await prisma.student.findMany({
          where: {
            OR: [
              { email: { in: rows.map((r) => r.email) } },
              { studentCode: { in: rows.map((r) => r.studentCode) } },
            ],
          },
          select: { id: true, email: true, studentCode: true },
        })
      : [];
    const existingEmails = new Set(existing.map((s) => s.email));
    const existingCodes = new Set(existing.map((s) => s.studentCode));
    const rowEmailSet = new Set(rows.map((r) => r.email));
    // How many of these emails already existed before we inserted anything.
    const preExistingByEmail = existing.filter((e) => rowEmailSet.has(e.email)).length;

    // Batched: at most ~3 round-trips regardless of how many students are
    // pasted. 1) insert genuinely-new students (admin-given code), 2) resolve
    // every row's id, 3) add them all to the batch. New = email AND code both
    // unseen in the DB.
    const newRows = rows.filter(
      (r) => !existingEmails.has(r.email) && !existingCodes.has(r.studentCode),
    );

    try {
      if (newRows.length) {
        await prisma.student.createMany({
          data: newRows.map((r) => ({
            studentCode: r.studentCode,
            name: r.name,
            email: r.email,
            accessStartDate: parsed.data.defaultStartDate,
            accessEndDate: parsed.data.defaultEndDate,
          })),
          skipDuplicates: true,
        });
      }
    } catch {
      return bad("create failed");
    }

    const all = rows.length
      ? await prisma.student.findMany({
          where: { email: { in: rows.map((r) => r.email) } },
          select: { id: true, email: true },
        })
      : [];
    const idByEmail = new Map(all.map((s) => [s.email, s.id]));
    const created = all.length - preExistingByEmail; // net new students inserted

    const studentIds = [
      ...new Set(rows.map((r) => idByEmail.get(r.email)).filter((x): x is string => !!x)),
    ];
    const membership = studentIds.length
      ? await prisma.studentBatch.createMany({
          data: studentIds.map((studentId) => ({ studentId, batchId: batch.id })),
          skipDuplicates: true,
        })
      : { count: 0 };
    const addedExisting = Math.max(0, membership.count - created);
    skipped += rows.length - created - addedExisting;

    // Optional: email the just-added students their "how to access" note. The
    // roster rows already carry name/email/studentCode, so no extra query.
    // Fire-and-forget — SMTP delivery must NOT block the "add students"
    // response (a slow mail server would otherwise hang the whole request).
    // The audit log is written when delivery finishes, in the background.
    let emailed = 0;
    const wantEmail = String(formData.get("sendEmail") ?? "") === "on";
    if (wantEmail && rows.length && isEmailConfigured()) {
      const subject = String(formData.get("emailSubject") ?? "").trim();
      const body = String(formData.get("emailBody") ?? "").trim();
      if (subject && body) {
        const recipients = rows.map((r) => ({ email: r.email, name: r.name, studentCode: r.studentCode }));
        emailed = recipients.length; // queued for delivery
        const actor = { id: admin.id, email: admin.email };
        void sendPersonalizedEmails(recipients, subject, body)
          .then((summary) =>
            createAuditLog({
              actorId: actor.id, actorEmail: actor.email, actorType: "admin",
              action: "EMAIL_SENT", entityType: "Batch", entityId: batch.id,
              newValue: {
                source: "bulk-add-to-batch", subject, recipients: recipients.length,
                sent: summary.sent, failed: summary.failed.length, skipped: summary.skipped.length,
              },
            }),
          )
          .catch(() => {});
      }
    }

    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BULK_STUDENTS_ADDED_TO_BATCH", entityType: "Batch", entityId: batch.id,
      newValue: { created, addedExisting, skipped, coursesAssigned, emailed, failedCount: failed.length },
    });
    revalidatePath("/admin/students");
    revalidatePath(`/admin/batches/${batch.id}`);
    return { ok: true, data: { created, addedExisting, skipped, coursesAssigned, emailed, failed } };
  });
}

// ============================================================
// Flow 2: full bootstrap
//   paste `studentCode,name,email,batchCode,courseNames` (+ -separated courses).
//   Ensures the batch exists, assigns the named courses to it, creates the
//   student and adds them to the batch. Optional applyBatchId adds everyone to
//   an additional existing batch.
// ============================================================
const bulkAddArgs = z.object({
  text: z.string().min(1).max(MAX_TEXT_LEN),
  defaultStartDate: dateSchema,
  defaultEndDate: dateSchema,
});

export async function bulkAddStudentsFromForm(
  formData: FormData,
): Promise<R<{ created: number; skipped: number; failed: { line: number; reason: string }[] }>> {
  return withAdminD(async (admin) => {
    const text = await readFormText(formData);
    if (typeof text !== "string") return bad(text.error);
    if (!text.trim()) return bad("no input provided");

    const parsed = bulkAddArgs.safeParse({
      text,
      defaultStartDate: formData.get("defaultStartDate"),
      defaultEndDate: formData.get("defaultEndDate"),
    });
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    if (parsed.data.defaultEndDate < parsed.data.defaultStartDate)
      return bad("endDate before startDate");

    const applyBatchId = String(formData.get("applyBatchId") ?? "") || null;

    const { rows: rawRows, errors } = parseBulkStudents(parsed.data.text);
    const failed = errors.map((e) => ({ line: e.line, reason: e.reason }));
    let skipped = 0;

    // Dedupe within input by studentCode + email (first wins).
    const seenCodes = new Set<string>();
    const seenEmails = new Set<string>();
    const rows = rawRows.filter((r) => {
      if (seenCodes.has(r.studentCode) || seenEmails.has(r.email)) { skipped++; return false; }
      seenCodes.add(r.studentCode); seenEmails.add(r.email);
      return true;
    });

    // Pre-resolve existing students, batches and courses.
    const [existing, courseRows] = await Promise.all([
      rows.length
        ? prisma.student.findMany({
            where: { OR: [
              { studentCode: { in: rows.map((r) => r.studentCode) } },
              { email: { in: rows.map((r) => r.email) } },
            ] },
            select: { studentCode: true, email: true },
          })
        : Promise.resolve([]),
      prisma.course.findMany({ select: { id: true, name: true } }),
    ]);
    const existingCodes = new Set(existing.map((s) => s.studentCode));
    const existingEmails = new Set(existing.map((s) => s.email));
    const courseByName = new Map(courseRows.map((c) => [c.name, c.id]));

    // Resolve / auto-create the referenced batches once.
    const batchCodes = [...new Set(rows.map((r) => r.batchCode).filter((b): b is string => !!b))];
    const batchByCode = new Map<string, string>();
    if (batchCodes.length) {
      const found = await prisma.batch.findMany({ where: { batchCode: { in: batchCodes } } });
      found.forEach((b) => batchByCode.set(b.batchCode, b.id));
      for (const code of batchCodes.filter((c) => !batchByCode.has(c))) {
        try {
          const b = await prisma.batch.create({
            data: { batchCode: code, batchName: code, description: "Auto-created from bulk student upload" },
          });
          batchByCode.set(code, b.id);
          await createAuditLog({
            actorId: admin.id, actorEmail: admin.email, actorType: "admin",
            action: "BATCH_CREATED", entityType: "Batch", entityId: b.id,
            newValue: { batchCode: code, source: "bulk-students-auto" },
          });
        } catch (e: any) {
          if (e?.code === "P2002") {
            const again = await prisma.batch.findUnique({ where: { batchCode: code }, select: { id: true } });
            if (again) batchByCode.set(code, again.id);
          }
        }
      }
      revalidateTag(CATALOG_TAGS.batches);
    }

    let created = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (existingCodes.has(row.studentCode) || existingEmails.has(row.email)) { skipped++; continue; }

      // Resolve this row's batch (row code, else applyBatchId).
      const rowBatchId = row.batchCode ? batchByCode.get(row.batchCode) : applyBatchId;
      const batchIds = [...new Set([rowBatchId, applyBatchId].filter((b): b is string => !!b))];

      // Resolve course names → ids (must exist).
      const courseIds: string[] = [];
      let courseErr: string | null = null;
      for (const n of row.courseNames) {
        const id = courseByName.get(n);
        if (!id) { courseErr = `unknown course "${n}"`; break; }
        courseIds.push(id);
      }
      if (courseErr) { failed.push({ line: i + 1, reason: courseErr }); continue; }

      try {
        await prisma.$transaction(async (tx) => {
          const s = await tx.student.create({
            data: {
              studentCode: row.studentCode,
              name: row.name,
              email: row.email,
              accessStartDate: parsed.data.defaultStartDate,
              accessEndDate: parsed.data.defaultEndDate,
            },
          });
          if (batchIds.length) {
            await tx.studentBatch.createMany({
              data: batchIds.map((batchId) => ({ studentId: s.id, batchId })),
              skipDuplicates: true,
            });
          }
          // Assign the row's named courses to the row's batch.
          if (courseIds.length && rowBatchId) {
            await tx.batchCourse.createMany({
              data: courseIds.map((courseId) => ({ batchId: rowBatchId, courseId })),
              skipDuplicates: true,
            });
          }
        });
        created++;
      } catch (e: any) {
        if (e?.code === "P2002") skipped++;
        else if (e?.code === "P2003") failed.push({ line: i + 1, reason: "invalid batch/course reference" });
        else failed.push({ line: i + 1, reason: "create failed" });
      }
    }

    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BULK_STUDENTS_CREATED", entityType: "Student",
      newValue: { created, skipped, failedCount: failed.length, applyBatchId },
    });
    revalidatePath("/admin/students");
    revalidatePath("/admin/batches");
    return { ok: true, data: { created, skipped, failed } };
  });
}

// ============================================================
// Bulk add batches (batchCode,batchName[,description[,courseNames]])
// ============================================================
const bulkBatchesArgs = z.object({ text: z.string().min(1).max(MAX_TEXT_LEN) });

export async function bulkAddBatchesFromForm(
  formData: FormData,
): Promise<R<{ created: number; skipped: number; failed: { line: number; reason: string }[] }>> {
  return withAdminD(async (admin) => {
    const text = await readFormText(formData);
    if (typeof text !== "string") return bad(text.error);
    if (!text.trim()) return bad("no input provided");

    const parsed = bulkBatchesArgs.safeParse({ text });
    if (!parsed.success) return bad(parsed.error.issues[0].message);

    const applyCourseIds = formData.getAll("applyCourseIds").map(String).filter(Boolean);

    const { rows: rawRows, errors } = parseBulkBatches(parsed.data.text);
    const failed = errors.map((e) => ({ line: e.line, reason: e.reason }));
    let skipped = 0;

    const seen = new Set<string>();
    const rows = rawRows.filter((r) => {
      if (seen.has(r.batchCode)) { skipped++; return false; }
      seen.add(r.batchCode);
      return true;
    });

    const [existing, coursesByName] = await Promise.all([
      rows.length
        ? prisma.batch.findMany({ where: { batchCode: { in: rows.map((r) => r.batchCode) } }, select: { batchCode: true } })
        : Promise.resolve([]),
      prisma.course
        .findMany({ select: { id: true, name: true } })
        .then((cs) => new Map(cs.map((c) => [c.name, c.id]))),
    ]);
    const existingCodes = new Set(existing.map((b) => b.batchCode));

    let created = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (existingCodes.has(row.batchCode)) { skipped++; continue; }

      const rowCourseIds: string[] = [];
      let resolveErr: string | null = null;
      for (const n of row.courseNames) {
        const id = coursesByName.get(n);
        if (!id) { resolveErr = `unknown course "${n}"`; break; }
        rowCourseIds.push(id);
      }
      if (resolveErr) { failed.push({ line: i + 1, reason: resolveErr }); continue; }
      const courseIds = [...new Set([...rowCourseIds, ...applyCourseIds])];

      try {
        await prisma.$transaction(async (tx) => {
          const b = await tx.batch.create({
            data: { batchCode: row.batchCode, batchName: row.batchName, description: row.description ?? null },
          });
          if (courseIds.length) {
            await tx.batchCourse.createMany({
              data: courseIds.map((courseId) => ({ batchId: b.id, courseId })),
              skipDuplicates: true,
            });
          }
        });
        created++;
      } catch (e: any) {
        if (e?.code === "P2002") skipped++;
        else if (e?.code === "P2003") failed.push({ line: i + 1, reason: "invalid course reference" });
        else failed.push({ line: i + 1, reason: "create failed" });
      }
    }

    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BULK_BATCHES_CREATED", entityType: "Batch",
      newValue: { created, skipped, failedCount: failed.length, applyCourseIdsCount: applyCourseIds.length },
    });
    revalidatePath("/admin/batches");
    if (created > 0) revalidateTag(CATALOG_TAGS.batches);
    return { ok: true, data: { created, skipped, failed } };
  });
}

// ============================================================
// Bulk add courses (name[,description[,status]])
// ============================================================
const bulkCoursesArgs = z.object({ text: z.string().min(1).max(MAX_TEXT_LEN) });

export async function bulkAddCoursesFromForm(
  formData: FormData,
): Promise<R<{ created: number; skipped: number; failed: { line: number; reason: string }[] }>> {
  return withAdminD(async (admin) => {
    const text = await readFormText(formData);
    if (typeof text !== "string") return bad(text.error);
    if (!text.trim()) return bad("no input provided");

    const parsed = bulkCoursesArgs.safeParse({ text });
    if (!parsed.success) return bad(parsed.error.issues[0].message);

    const { rows: rawRows, errors } = parseBulkCourses(parsed.data.text);
    const failed = errors.map((e) => ({ line: e.line, reason: e.reason }));
    let skipped = 0;

    const seen = new Set<string>();
    const rows = rawRows.filter((r) => {
      if (seen.has(r.name)) { skipped++; return false; }
      seen.add(r.name);
      return true;
    });

    const existing = rows.length
      ? await prisma.course.findMany({ where: { name: { in: rows.map((r) => r.name) } }, select: { name: true } })
      : [];
    const existingNames = new Set(existing.map((c) => c.name));

    let created = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (existingNames.has(row.name)) { skipped++; continue; }
      try {
        await prisma.course.create({
          data: { name: row.name, description: row.description ?? null, status: row.status ?? "active" },
        });
        created++;
      } catch (e: any) {
        if (e?.code === "P2002") skipped++;
        else failed.push({ line: i + 1, reason: "create failed" });
      }
    }

    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BULK_COURSES_CREATED", entityType: "Course",
      newValue: { created, skipped, failedCount: failed.length },
    });
    revalidatePath("/admin/courses");
    if (created > 0) revalidateTag(CATALOG_TAGS.courses);
    return { ok: true, data: { created, skipped, failed } };
  });
}

// ============================================================
// Generic bulk action over selected students (admin search page)
// ============================================================
export async function bulkAction(
  input: unknown,
): Promise<R<{ count: number; skipped: { studentId: string; reason: string }[] }>> {
  return withAdminD(async (admin) => {
    const parsed = bulkActionSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const data = parsed.data;
    const skipped: { studentId: string; reason: string }[] = [];
    let count = 0;
    let auditAction: AuditAction = "BULK_STUDENTS_ADDED_TO_BATCH";

    if (data.action === "add_to_batch") {
      const r = await prisma.studentBatch.createMany({
        data: data.studentIds.map((studentId) => ({ studentId, batchId: data.batchId })),
        skipDuplicates: true,
      });
      count = r.count;
      auditAction = "BULK_STUDENTS_ADDED_TO_BATCH";
    } else if (data.action === "remove_from_batch") {
      const r = await prisma.studentBatch.deleteMany({
        where: { studentId: { in: data.studentIds }, batchId: data.batchId },
      });
      count = r.count;
      auditAction = "BULK_STUDENTS_REMOVED_FROM_BATCH";
    } else if (data.action === "block") {
      const r = await prisma.student.updateMany({ where: { id: { in: data.studentIds } }, data: { status: "blocked" } });
      count = r.count;
      auditAction = "BULK_STUDENTS_BLOCKED";
    } else if (data.action === "activate") {
      const r = await prisma.student.updateMany({ where: { id: { in: data.studentIds } }, data: { status: "active" } });
      count = r.count;
      auditAction = "BULK_STUDENTS_ACTIVATED";
    } else if (data.action === "set_end_date") {
      const r = await prisma.student.updateMany({
        where: { id: { in: data.studentIds } },
        data: { accessEndDate: data.endDate },
      });
      count = r.count;
      auditAction = "BULK_STUDENTS_END_DATE_CHANGED";
    } else if (data.action === "delete") {
      const r = await prisma.student.deleteMany({ where: { id: { in: data.studentIds } } });
      count = r.count;
      auditAction = "BULK_STUDENTS_DELETED";
    }

    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: auditAction, entityType: "Student",
      newValue: { ...data, count, skippedCount: skipped.length },
    });
    revalidatePath("/admin/search");
    revalidatePath("/admin/students");
    return { ok: true, data: { count, skipped } };
  });
}

/**
 * Resolves a paste of student codes/emails to studentIds. Used by the search
 * page's "paste IDs" form before calling bulkAction.
 */
export async function resolveStudentIdentifiers(
  text: string,
): Promise<R<{ studentIds: string[]; unknown: string[] }>> {
  return withAdminD(async () => {
    if (typeof text !== "string" || !text.trim()) return bad("no input");
    const idents = parseIdentifierList(text);
    if (idents.length === 0) return { ok: true, data: { studentIds: [], unknown: [] } };
    const matches = await prisma.student.findMany({
      where: { OR: [
        { studentCode: { in: idents } },
        { email: { in: idents.map((i) => i.toLowerCase()) } },
      ] },
      select: { id: true, studentCode: true, email: true },
    });
    const byKey = new Map<string, string>();
    for (const s of matches) {
      byKey.set(s.studentCode, s.id);
      byKey.set(s.email.toLowerCase(), s.id);
    }
    const seen = new Set<string>();
    const studentIds: string[] = [];
    const unknown: string[] = [];
    for (const ident of idents) {
      const id = byKey.get(ident) ?? byKey.get(ident.toLowerCase());
      if (!id) unknown.push(ident);
      else if (!seen.has(id)) { seen.add(id); studentIds.push(id); }
    }
    return { ok: true, data: { studentIds, unknown } };
  });
}

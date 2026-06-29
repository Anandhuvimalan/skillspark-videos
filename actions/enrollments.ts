"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import { idSchema, batchCoursesSchema, studentBatchesSchema } from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";

/**
 * Batch is the only access path now: a batch has courses (`BatchCourse`) and
 * students (`StudentBatch`); a student can watch the union of their batches'
 * courses. These actions manage those two mappings.
 */

// ---------- Batch ↔ Course ----------
export async function assignCourseToBatch(batchId: string, courseId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(batchId).success || !idSchema.safeParse(courseId).success)
      return bad("invalid id");
    try {
      await prisma.batchCourse.create({ data: { batchId, courseId } });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "BATCH_COURSE_ASSIGNED", entityType: "Batch", entityId: batchId,
        newValue: { courseId },
      });
      revalidatePath(`/admin/batches/${batchId}`);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("already assigned");
      if (e?.code === "P2003") return bad("batch or course not found");
      return bad("assign failed");
    }
  });
}

export async function removeCourseFromBatch(batchId: string, courseId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(batchId).success || !idSchema.safeParse(courseId).success)
      return bad("invalid id");
    await prisma.batchCourse.deleteMany({ where: { batchId, courseId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "BATCH_COURSE_REMOVED", entityType: "Batch", entityId: batchId,
      oldValue: { courseId },
    });
    revalidatePath(`/admin/batches/${batchId}`);
    return { ok: true };
  });
}

// ---------- Student ↔ Batch ----------
export async function addStudentToBatch(studentId: string, batchId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(studentId).success || !idSchema.safeParse(batchId).success)
      return bad("invalid id");
    try {
      await prisma.studentBatch.create({ data: { studentId, batchId } });
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_BATCH_ASSIGNED", entityType: "Student", entityId: studentId,
        newValue: { batchId },
      });
      revalidatePath(`/admin/students/${studentId}`);
      revalidatePath(`/admin/batches/${batchId}`);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("already in batch");
      if (e?.code === "P2003") return bad("student or batch not found");
      return bad("add failed");
    }
  });
}

export async function removeStudentFromBatch(studentId: string, batchId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(studentId).success || !idSchema.safeParse(batchId).success)
      return bad("invalid id");
    await prisma.studentBatch.deleteMany({ where: { studentId, batchId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "STUDENT_BATCH_REMOVED", entityType: "Student", entityId: studentId,
      oldValue: { batchId },
    });
    revalidatePath(`/admin/students/${studentId}`);
    revalidatePath(`/admin/batches/${batchId}`);
    return { ok: true };
  });
}

/** Diff: set the exact course list for a batch (used by the batch hub picker). */
export async function setBatchCourses(input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    const parsed = batchCoursesSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const { batchId, courseIds } = parsed.data;

    const current = await prisma.batchCourse.findMany({
      where: { batchId }, select: { courseId: true },
    });
    const have = new Set(current.map((c) => c.courseId));
    const want = new Set(courseIds);
    const toAdd = [...want].filter((id) => !have.has(id));
    const toRemove = [...have].filter((id) => !want.has(id));

    try {
      await prisma.$transaction([
        ...(toAdd.length
          ? [prisma.batchCourse.createMany({
              data: toAdd.map((courseId) => ({ batchId, courseId })),
              skipDuplicates: true,
            })]
          : []),
        ...(toRemove.length
          ? [prisma.batchCourse.deleteMany({ where: { batchId, courseId: { in: toRemove } } })]
          : []),
      ]);
    } catch (e: any) {
      if (e?.code === "P2003") return bad("invalid batch/course reference");
      return bad("update failed");
    }

    if (toAdd.length || toRemove.length) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: toRemove.length && !toAdd.length ? "BATCH_COURSE_REMOVED" : "BATCH_COURSE_ASSIGNED",
        entityType: "Batch", entityId: batchId,
        newValue: { added: toAdd, removed: toRemove },
      });
    }
    revalidatePath(`/admin/batches/${batchId}`);
    return { ok: true };
  });
}

/** Diff: set the exact batch list for a student (used by the student edit page). */
export async function setStudentBatches(input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    const parsed = studentBatchesSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const { studentId, batchIds } = parsed.data;

    const current = await prisma.studentBatch.findMany({
      where: { studentId }, select: { batchId: true },
    });
    const have = new Set(current.map((b) => b.batchId));
    const want = new Set(batchIds);
    const toAdd = [...want].filter((id) => !have.has(id));
    const toRemove = [...have].filter((id) => !want.has(id));

    try {
      await prisma.$transaction([
        ...(toAdd.length
          ? [prisma.studentBatch.createMany({
              data: toAdd.map((batchId) => ({ studentId, batchId })),
              skipDuplicates: true,
            })]
          : []),
        ...(toRemove.length
          ? [prisma.studentBatch.deleteMany({ where: { studentId, batchId: { in: toRemove } } })]
          : []),
      ]);
    } catch (e: any) {
      if (e?.code === "P2003") return bad("invalid student/batch reference");
      return bad("update failed");
    }

    if (toAdd.length || toRemove.length) {
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: toRemove.length && !toAdd.length ? "STUDENT_BATCH_REMOVED" : "STUDENT_BATCH_ASSIGNED",
        entityType: "Student", entityId: studentId,
        newValue: { added: toAdd, removed: toRemove },
      });
    }
    revalidatePath(`/admin/students/${studentId}`);
    return { ok: true };
  });
}

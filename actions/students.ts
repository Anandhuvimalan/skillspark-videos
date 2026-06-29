"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";
import {
  studentCreateSchema,
  studentUpdateSchema,
  idSchema,
} from "@/lib/validations";
import { bad, withAdmin, type R } from "./_shared";

/** Re-exported for callers that imported the old name. */
export type ActionResult<T = unknown> = R<T>;

/**
 * Create a student and (optionally) add them to one or more existing batches.
 * Access = the union of those batches' courses; an empty batch list creates a
 * student who can't watch anything yet (the admin can add them to a batch later).
 */
export async function createStudent(input: unknown): Promise<R<{ id: string }>> {
  return withAdmin(async (admin) => {
    const parsed = studentCreateSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const data = parsed.data;

    try {
      const student = await prisma.$transaction(async (tx) => {
        const s = await tx.student.create({
          data: {
            studentCode: data.studentCode,
            name: data.name,
            email: data.email,
            accessStartDate: data.accessStartDate,
            accessEndDate: data.accessEndDate,
          },
        });
        if (data.batchIds.length) {
          await tx.studentBatch.createMany({
            data: data.batchIds.map((batchId) => ({ studentId: s.id, batchId })),
            skipDuplicates: true,
          });
        }
        return s;
      });

      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action: "STUDENT_CREATED", entityType: "Student", entityId: student.id,
        newValue: { ...student, batchIds: data.batchIds },
      });
      for (const batchId of data.batchIds) {
        await createAuditLog({
          actorId: admin.id, actorEmail: admin.email, actorType: "admin",
          action: "STUDENT_BATCH_ASSIGNED", entityType: "Student", entityId: student.id,
          newValue: { batchId },
        });
      }
      revalidatePath("/admin/students");
      return { ok: true, data: { id: student.id } };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate email or studentCode");
      if (e?.code === "P2003") return bad("invalid batch reference");
      return bad("create failed");
    }
  });
}

export async function updateStudent(studentId: string, input: unknown): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(studentId).success) return bad("invalid id");
    const parsed = studentUpdateSchema.safeParse(input);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    const data = parsed.data;
    const before = await prisma.student.findUnique({ where: { id: studentId } });
    if (!before) return bad("not found");

    try {
      const after = await prisma.student.update({
        where: { id: studentId },
        data,
      });
      const action =
        data.status === "blocked" && before.status !== "blocked"
          ? "STUDENT_BLOCKED"
          : data.status === "active" && before.status !== "active"
            ? "STUDENT_ACTIVATED"
            : (data.accessStartDate &&
                  +data.accessStartDate !== +before.accessStartDate) ||
                (data.accessEndDate &&
                  +data.accessEndDate !== +before.accessEndDate)
              ? "STUDENT_ACCESS_DATES_CHANGED"
              : "STUDENT_UPDATED";
      await createAuditLog({
        actorId: admin.id, actorEmail: admin.email, actorType: "admin",
        action, entityType: "Student", entityId: studentId,
        oldValue: before, newValue: after,
      });
      revalidatePath("/admin/students");
      revalidatePath(`/admin/students/${studentId}`);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return bad("duplicate email or studentCode");
      return bad("update failed");
    }
  });
}

/**
 * Form-action wrapper for the student-add page (React 19 `useActionState`):
 * signature `(prevState, formData) => nextState`, returns a serializable result.
 */
export type StudentFormState = {
  ok: boolean;
  error?: string;
  /** Increments on each successful create; the form uses it as a `key` to reset. */
  submittedAt?: number;
};

export async function createStudentFormAction(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const r = await createStudent({
    studentCode: formData.get("studentCode"),
    name: formData.get("name"),
    email: formData.get("email"),
    batchIds: formData.getAll("batchIds"),
    accessStartDate: formData.get("accessStartDate"),
    accessEndDate: formData.get("accessEndDate"),
  });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/admin/students");
  return { ok: true, submittedAt: Date.now() };
}

export async function deleteStudent(studentId: string): Promise<R> {
  return withAdmin(async (admin) => {
    if (!idSchema.safeParse(studentId).success) return bad("invalid id");
    const before = await prisma.student.findUnique({ where: { id: studentId } });
    if (!before) return bad("not found");
    await prisma.student.delete({ where: { id: studentId } });
    await createAuditLog({
      actorId: admin.id, actorEmail: admin.email, actorType: "admin",
      action: "STUDENT_DELETED", entityType: "Student", entityId: studentId,
      oldValue: before,
    });
    revalidatePath("/admin/students");
    return { ok: true };
  });
}

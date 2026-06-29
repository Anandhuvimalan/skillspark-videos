import { prisma } from "@/lib/db";

/**
 * Batch-centric access model (the core invariant).
 *
 * A student belongs to one or more batches (`StudentBatch`). Each batch has a
 * set of courses assigned to it (`BatchCourse`), added progressively as classes
 * happen. A student can access a course iff:
 *
 *   - the student is active and within their access window (checked by the
 *     caller, e.g. `requireStudent`), AND
 *   - the course is active, AND
 *   - some batch the student belongs to has that course assigned.
 *
 * There are no packages, direct per-student enrollments, or denials.
 * `getAccessibleCourses` returns the union across all of a student's batches.
 */

export type DashboardCourse = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  layout: string;
};

/**
 * All unique active courses a student can access (union of every batch they
 * belong to). Does NOT check student status/expiry — the caller must.
 */
export async function getAccessibleCourses(studentId: string) {
  const rows = await prisma.batchCourse.findMany({
    where: { batch: { studentBatches: { some: { studentId } } } },
    select: { courseId: true },
  });
  const ids = [...new Set(rows.map((r) => r.courseId))];
  if (ids.length === 0) return [];
  return prisma.course.findMany({
    where: { id: { in: ids }, status: "active" },
    orderBy: { name: "asc" },
  });
}

export async function canAccessCourse(studentId: string, courseId: string): Promise<boolean> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { status: true },
  });
  if (!course || course.status !== "active") return false;

  const grant = await prisma.batchCourse.findFirst({
    where: { courseId, batch: { studentBatches: { some: { studentId } } } },
    select: { id: true },
  });
  return !!grant;
}

/**
 * Inverse of access: every studentId that can reach `courseId` (because one of
 * their batches has it assigned). Used by admin search/filtering.
 */
export async function getStudentsWithCourseAccess(courseId: string): Promise<string[]> {
  const rows = await prisma.studentBatch.findMany({
    where: { batch: { batchCourses: { some: { courseId } } } },
    select: { studentId: true },
  });
  return [...new Set(rows.map((r) => r.studentId))];
}

/**
 * Dashboard payload: the student's accessible courses (flat list). Batches are
 * an admin grouping concern; students just see the courses they can watch.
 */
export async function getDashboard(studentId: string): Promise<{ courses: DashboardCourse[] }> {
  const accessible = await getAccessibleCourses(studentId);
  return {
    courses: accessible.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      imageUrl: (c as { imageUrl?: string | null }).imageUrl ?? null,
      layout: c.layout,
    })),
  };
}

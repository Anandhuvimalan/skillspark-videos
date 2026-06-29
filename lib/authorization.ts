import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessCourse } from "@/lib/course-access";
import { createAuditLog } from "@/lib/audit-log";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export type SessionUser = {
  email: string;
  name: string | null;
  role: "admin" | "student";
  adminId?: string;
  studentId?: string;
};

/**
 * Resolve the session user. Wrapped in React `cache()` so the multiple callers
 * within a single server render (admin layout + page, requireStudent + access
 * checks, etc.) share ONE `auth()` cookie verification instead of repeating it.
 */
export const getCurrentSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.email || !session.user.role) return null;
  return {
    email: session.user.email,
    name: session.user.name ?? null,
    role: session.user.role,
    adminId: session.user.adminId,
    studentId: session.user.studentId,
  };
});

export async function requireAdmin() {
  const user = await getCurrentSessionUser();
  if (!user || user.role !== "admin" || !user.adminId) {
    await createAuditLog({
      actorEmail: user?.email ?? null,
      actorType: user ? "student" : "system",
      action: "UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT",
    });
    throw new AuthError("Admin access required", 403);
  }
  const admin = await prisma.admin.findUnique({ where: { id: user.adminId } });
  if (!admin || admin.status !== "active") {
    throw new AuthError("Admin not active", 403);
  }
  return { user, admin };
}

export async function requireStudent() {
  const user = await getCurrentSessionUser();
  if (!user || user.role !== "student" || !user.studentId) {
    throw new AuthError("Student access required", 403);
  }
  const student = await prisma.student.findUnique({ where: { id: user.studentId } });
  if (!student) throw new AuthError("Student record missing", 403);
  if (student.status !== "active") throw new AuthError("Student blocked", 403);
  const now = new Date();
  if (student.accessStartDate > now || student.accessEndDate < now) {
    throw new AuthError("Student access expired", 403);
  }
  return { user, student };
}

export async function getCurrentStudent() {
  const user = await getCurrentSessionUser();
  if (!user || user.role !== "student" || !user.studentId) return null;
  return prisma.student.findUnique({ where: { id: user.studentId } });
}

export async function isStudentActive(studentId: string): Promise<boolean> {
  const s = await prisma.student.findUnique({
    where: { id: studentId },
    select: { status: true },
  });
  return !!s && s.status === "active";
}

export async function isStudentExpired(studentId: string): Promise<boolean> {
  const s = await prisma.student.findUnique({
    where: { id: studentId },
    select: { accessStartDate: true, accessEndDate: true },
  });
  if (!s) return true;
  const now = new Date();
  return s.accessStartDate > now || s.accessEndDate < now;
}

/** Checks course access and audit-logs failures. */
export async function requireCourseAccess(studentId: string, courseId: string) {
  const ok = await canAccessCourse(studentId, courseId);
  if (!ok) {
    await createAuditLog({
      actorId: studentId,
      actorType: "student",
      action: "UNAUTHORIZED_COURSE_ACCESS_ATTEMPT",
      entityType: "Course",
      entityId: courseId,
    });
    throw new AuthError("Course access denied", 403);
  }
}

export async function canAccessModule(studentId: string, moduleId: string): Promise<boolean> {
  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { courseId: true, course: { select: { status: true } } },
  });
  if (!mod || mod.course.status !== "active") return false;
  return canAccessCourse(studentId, mod.courseId);
}

export async function canAccessVideo(studentId: string, videoId: string): Promise<boolean> {
  const v = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      status: true,
      courseId: true,
      course: { select: { status: true } },
      module: { select: { courseId: true, course: { select: { status: true } } } },
    },
  });
  if (!v || v.status !== "active") return false;
  // Flat-layout video: parent is the course directly.
  if (v.courseId) {
    if (!v.course || v.course.status !== "active") return false;
    return canAccessCourse(studentId, v.courseId);
  }
  // Module-layout video: parent is module → course.
  if (v.module) {
    if (v.module.course.status !== "active") return false;
    return canAccessCourse(studentId, v.module.courseId);
  }
  return false;
}

export async function canAccessNote(studentId: string, noteId: string): Promise<boolean> {
  const n = await prisma.note.findUnique({
    where: { id: noteId },
    select: { videoId: true },
  });
  if (!n) return false;
  return canAccessVideo(studentId, n.videoId);
}

export async function requireVideoAccess(studentId: string, videoId: string) {
  const ok = await canAccessVideo(studentId, videoId);
  if (!ok) {
    await createAuditLog({
      actorId: studentId,
      actorType: "student",
      action: "UNAUTHORIZED_VIDEO_ACCESS_ATTEMPT",
      entityType: "Video",
      entityId: videoId,
    });
    throw new AuthError("Video access denied", 403);
  }
}

export async function requireNoteAccess(studentId: string, noteId: string) {
  const ok = await canAccessNote(studentId, noteId);
  if (!ok) {
    await createAuditLog({
      actorId: studentId,
      actorType: "student",
      action: "UNAUTHORIZED_NOTE_ACCESS_ATTEMPT",
      entityType: "Note",
      entityId: noteId,
    });
    throw new AuthError("Note access denied", 403);
  }
}

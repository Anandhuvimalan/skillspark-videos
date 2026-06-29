/**
 * Admin analytics — read-only aggregations for the home-page dashboard.
 *
 * Watch-time estimate:
 *   Per VideoProgress row we count
 *     - completed=true  → video.duration  (full credit)
 *     - completed=false → lastTimestamp   (resume position as best-effort)
 *   This is a reasonable proxy without a separate watch-events table.
 *
 * All numbers are clamped to non-negative; missing durations are treated as 0.
 *
 * Performance: every helper runs at most one DB query, joined where needed,
 * and groups in JS (the dataset is small enough that this is faster than
 * forcing SQLite to do GROUP BY across joins).
 */
import "server-only";
import { prisma } from "@/lib/db";

export type KpiSnapshot = {
  totals: {
    students: number;
    activeStudents: number;
    blockedStudents: number;
    expiredStudents: number;
    batches: number;
    courses: number;
    modules: number;
    videos: number;
    notes: number;
    auditEvents: number;
  };
  watch: {
    totalSeconds: number;
    completedVideos: number;
    inProgressVideos: number;
    avgSecondsPerStudent: number;
    activeLearners30d: number;
    overallCompletionPct: number;
  };
};

export async function getKpiSnapshot(): Promise<KpiSnapshot> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    students,
    activeStudents,
    blockedStudents,
    expiredStudents,
    batches,
    courses,
    modules,
    videos,
    notes,
    auditEvents,
    progressRows,
    activeLearners30d,
  ] = await Promise.all([
    prisma.student.count(),
    prisma.student.count({
      where: { status: "active", accessStartDate: { lte: now }, accessEndDate: { gte: now } },
    }),
    prisma.student.count({ where: { status: "blocked" } }),
    prisma.student.count({
      where: {
        status: "active",
        OR: [{ accessEndDate: { lt: now } }, { accessStartDate: { gt: now } }],
      },
    }),
    prisma.batch.count(),
    prisma.course.count(),
    prisma.module.count(),
    prisma.video.count(),
    prisma.note.count(),
    prisma.auditLog.count(),
    prisma.videoProgress.findMany({
      select: {
        completed: true,
        lastTimestamp: true,
        video: { select: { duration: true } },
      },
    }),
    prisma.videoProgress
      .findMany({
        where: { updatedAt: { gte: thirtyDaysAgo } },
        distinct: ["studentId"],
        select: { studentId: true },
      })
      .then((rs) => rs.length),
  ]);

  let totalSeconds = 0;
  let completedVideos = 0;
  let inProgressVideos = 0;
  for (const p of progressRows) {
    if (p.completed) {
      completedVideos++;
      totalSeconds += Math.max(0, p.video?.duration ?? 0);
    } else if (p.lastTimestamp > 0) {
      inProgressVideos++;
      totalSeconds += Math.max(0, p.lastTimestamp);
    }
  }
  const avgSecondsPerStudent = students > 0 ? totalSeconds / students : 0;
  const overallCompletionPct =
    progressRows.length > 0
      ? Math.round((completedVideos / progressRows.length) * 100)
      : 0;

  return {
    totals: {
      students,
      activeStudents,
      blockedStudents,
      expiredStudents,
      batches,
      courses,
      modules,
      videos,
      notes,
      auditEvents,
    },
    watch: {
      totalSeconds,
      completedVideos,
      inProgressVideos,
      avgSecondsPerStudent,
      activeLearners30d,
      overallCompletionPct,
    },
  };
}

// ---------- Daily activity (last 30 days) ----------

export type DailyActivityPoint = {
  date: string; // YYYY-MM-DD
  uniqueStudents: number;
  progressUpdates: number;
};

export async function getDailyActivity(days = 30): Promise<DailyActivityPoint[]> {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const rows = await prisma.videoProgress.findMany({
    where: { updatedAt: { gte: start } },
    select: { updatedAt: true, studentId: true },
  });

  const byDay = new Map<string, Set<string>>();
  const updatesByDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, new Set());
    updatesByDay.set(key, 0);
  }
  for (const r of rows) {
    const key = r.updatedAt.toISOString().slice(0, 10);
    const set = byDay.get(key);
    if (set) {
      set.add(r.studentId);
      updatesByDay.set(key, (updatesByDay.get(key) ?? 0) + 1);
    }
  }
  return [...byDay.entries()].map(([date, students]) => ({
    date,
    uniqueStudents: students.size,
    progressUpdates: updatesByDay.get(date) ?? 0,
  }));
}

// ---------- Top courses by watch time ----------

export type TopCoursePoint = {
  courseId: string;
  name: string;
  watchSeconds: number;
  completedCount: number;
  totalProgressRows: number;
};

export async function getTopCourses(limit = 8): Promise<TopCoursePoint[]> {
  const progressRows = await prisma.videoProgress.findMany({
    select: {
      completed: true,
      lastTimestamp: true,
      video: {
        select: {
          duration: true,
          courseId: true,
          module: { select: { courseId: true } },
        },
      },
    },
  });

  type Agg = { watchSeconds: number; completedCount: number; totalProgressRows: number };
  const byCourseId = new Map<string, Agg>();
  for (const p of progressRows) {
    const cid = p.video?.courseId ?? p.video?.module?.courseId ?? null;
    if (!cid) continue;
    const seconds = p.completed
      ? Math.max(0, p.video?.duration ?? 0)
      : Math.max(0, p.lastTimestamp);
    const cur = byCourseId.get(cid) ?? { watchSeconds: 0, completedCount: 0, totalProgressRows: 0 };
    cur.watchSeconds += seconds;
    cur.totalProgressRows += 1;
    if (p.completed) cur.completedCount += 1;
    byCourseId.set(cid, cur);
  }
  if (byCourseId.size === 0) return [];
  const courses = await prisma.course.findMany({
    where: { id: { in: [...byCourseId.keys()] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(courses.map((c) => [c.id, c.name]));
  return [...byCourseId.entries()]
    .map(([courseId, agg]) => ({
      courseId,
      name: nameById.get(courseId) ?? "(deleted)",
      ...agg,
    }))
    .sort((a, b) => b.watchSeconds - a.watchSeconds)
    .slice(0, limit);
}

// ---------- Top students by watch time ----------

export type TopStudentPoint = {
  studentId: string;
  name: string;
  email: string;
  watchSeconds: number;
  completedCount: number;
};

export async function getTopStudents(limit = 8): Promise<TopStudentPoint[]> {
  const progressRows = await prisma.videoProgress.findMany({
    select: {
      studentId: true,
      completed: true,
      lastTimestamp: true,
      video: { select: { duration: true } },
    },
  });
  type Agg = { watchSeconds: number; completedCount: number };
  const byStudent = new Map<string, Agg>();
  for (const p of progressRows) {
    const seconds = p.completed
      ? Math.max(0, p.video?.duration ?? 0)
      : Math.max(0, p.lastTimestamp);
    const cur = byStudent.get(p.studentId) ?? { watchSeconds: 0, completedCount: 0 };
    cur.watchSeconds += seconds;
    if (p.completed) cur.completedCount += 1;
    byStudent.set(p.studentId, cur);
  }
  if (byStudent.size === 0) return [];
  const ids = [...byStudent.keys()];
  const students = await prisma.student.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  const meta = new Map(students.map((s) => [s.id, s]));
  return [...byStudent.entries()]
    .map(([sid, agg]) => ({
      studentId: sid,
      name: meta.get(sid)?.name ?? "(deleted)",
      email: meta.get(sid)?.email ?? "",
      ...agg,
    }))
    .sort((a, b) => b.watchSeconds - a.watchSeconds)
    .slice(0, limit);
}

// ---------- Course completion rate ----------

export type CompletionPoint = {
  courseId: string;
  name: string;
  /** Completed video-rows / total video-rows for this course (across all students). */
  completionPct: number;
  completed: number;
  total: number;
};

export async function getCompletionByCourse(limit = 8): Promise<CompletionPoint[]> {
  const top = await getTopCourses(50);
  return top
    .filter((c) => c.totalProgressRows > 0)
    .map((c) => ({
      courseId: c.courseId,
      name: c.name,
      completionPct: Math.round((c.completedCount / c.totalProgressRows) * 100),
      completed: c.completedCount,
      total: c.totalProgressRows,
    }))
    .sort((a, b) => b.completionPct - a.completionPct)
    .slice(0, limit);
}

// ---------- Audit activity by day (last 30) ----------

export async function getAuditActivity(days = 30): Promise<{ date: string; count: number }[]> {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  const rows = await prisma.auditLog.findMany({
    where: { createdAt: { gte: start } },
    select: { createdAt: true },
  });
  const map = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of rows) {
    const key = r.createdAt.toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([date, count]) => ({ date, count }));
}

// ---------- Helpers used by chart formatters ----------

export function secondsToReadable(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 100) return `${h.toLocaleString()}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  Clock,
  Play,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudent, AuthError } from "@/lib/authorization";
import { getDashboard, type DashboardCourse } from "@/lib/course-access";
import StudentTopbar from "@/components/StudentTopbar";

function formatDuration(s: number): string | null {
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(s)}s`;
}

export default async function Dashboard() {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=denied");
    throw e;
  }
  // Fetch the dashboard catalog, the resume target, and progress counts in
  // parallel — they're independent, so there's no reason to await in series.
  const [{ courses }, lastProgress, completedLessons, inProgressLessons] =
    await Promise.all([
      getDashboard(student.id),
      // "Continue learning" — most recently touched, not-yet-completed video.
      prisma.videoProgress.findFirst({
        where: { studentId: student.id, completed: false },
        orderBy: { updatedAt: "desc" },
        include: {
          video: {
            select: {
              id: true,
              title: true,
              duration: true,
              courseId: true,
              module: { select: { title: true, course: { select: { id: true, name: true } } } },
              course: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.videoProgress.count({
        where: { studentId: student.id, completed: true },
      }),
      prisma.videoProgress.count({
        where: { studentId: student.id, completed: false, lastTimestamp: { gt: 0 } },
      }),
    ]);

  const hasContent = courses.length > 0;
  const totalCourses = courses.length;
  const accessUntil = student.accessEndDate.toISOString().slice(0, 10);
  const daysLeft = Math.max(
    0,
    Math.ceil((student.accessEndDate.getTime() - Date.now()) / 86_400_000),
  );
  const firstName = student.name.split(" ")[0] ?? "there";
  const resume =
    lastProgress?.video
      ? (() => {
          const v = lastProgress.video;
          const course = v.course ?? v.module?.course ?? null;
          const ratio =
            v.duration && v.duration > 0
              ? Math.min(1, lastProgress.lastTimestamp / v.duration)
              : 0;
          return {
            videoId: v.id,
            title: v.title,
            courseName: course?.name ?? "Your course",
            moduleTitle: v.module?.title ?? null,
            ratio,
            ratioPct: Math.round(ratio * 100),
            remainingLabel:
              v.duration && v.duration > 0
                ? formatDuration(Math.max(0, v.duration - lastProgress.lastTimestamp))
                : null,
          };
        })()
      : null;

  return (
    <div className="sx-shell">
      <StudentTopbar accessUntil={accessUntil} />

      <main className="sx-page" id="main-content">
        <section className="sx-hero">
          <div className="sx-hero-text">
            <span className="sx-eyebrow">
              <Sparkles size={13} aria-hidden="true" />
              Welcome back
            </span>
            <h1>
              Hi, <span className="sx-hero-name">{firstName}</span>.
            </h1>
            <p>
              {totalCourses > 0
                ? `You have ${totalCourses} course${totalCourses === 1 ? "" : "s"} ready. Pick up where you left off or start something new.`
                : "Your library is empty for now. Reach out to your admin to get started."}
            </p>
            <div className="sx-chips">
              <span className="sx-chip">
                <BookOpen size={14} aria-hidden="true" />
                <strong>{courses.length}</strong>
                <small>course{courses.length === 1 ? "" : "s"}</small>
              </span>
              <span className="sx-chip">
                <CalendarDays size={14} aria-hidden="true" />
                <strong>{accessUntil}</strong>
                <small>access until</small>
              </span>
            </div>
          </div>

          {resume ? (
            <Link href={`/videos/${resume.videoId}`} className="sx-resume">
              <span className="sx-resume-cover" aria-hidden="true">
                <span className="sx-resume-play">
                  <Play size={22} strokeWidth={2.2} fill="currentColor" />
                </span>
              </span>
              <span className="sx-resume-body">
                <span className="sx-resume-eyebrow">
                  <PlayCircle size={12} aria-hidden="true" />
                  Continue learning
                </span>
                <span className="sx-resume-title">{resume.title}</span>
                <span className="sx-resume-context">
                  {resume.moduleTitle ? `${resume.moduleTitle} · ` : ""}
                  {resume.courseName}
                </span>
                <span className="sx-resume-meter">
                  <span className="sx-resume-bar">
                    <span style={{ width: `${Math.max(2, resume.ratioPct)}%` }} />
                  </span>
                  <span className="sx-resume-meta">
                    <span>{resume.ratioPct}% done</span>
                    {resume.remainingLabel ? (
                      <span>
                        <Clock size={11} aria-hidden="true" />
                        {resume.remainingLabel} left
                      </span>
                    ) : null}
                  </span>
                </span>
              </span>
            </Link>
          ) : (
            <div className="sx-resume" aria-hidden="true">
              <span className="sx-resume-cover">
                <span className="sx-resume-play sx-resume-play--idle">
                  <Sparkles size={22} strokeWidth={2} />
                </span>
              </span>
              <span className="sx-resume-body">
                <span className="sx-resume-eyebrow">Ready when you are</span>
                <span className="sx-resume-title">Nothing in progress</span>
                <span className="sx-resume-context">
                  Open any course below and start a lesson — your spot is saved.
                </span>
              </span>
            </div>
          )}
        </section>

        {hasContent && (
          <section className="sx-statband" aria-label="Your learning at a glance">
            <div className="sx-stat">
              <span className="sx-stat-label">Courses</span>
              <span className="sx-stat-value">{totalCourses}</span>
              <span className="sx-stat-hint">in your library</span>
            </div>
            <div className="sx-stat" data-tone="green">
              <span className="sx-stat-label">Completed</span>
              <span className="sx-stat-value">{completedLessons}</span>
              <span className="sx-stat-hint">lessons finished</span>
            </div>
            <div className="sx-stat" data-tone="amber">
              <span className="sx-stat-label">In progress</span>
              <span className="sx-stat-value">{inProgressLessons}</span>
              <span className="sx-stat-hint">waiting for you</span>
            </div>
            <div className="sx-stat">
              <span className="sx-stat-label">Access left</span>
              <span className="sx-stat-value">{daysLeft}</span>
              <span className="sx-stat-hint">day{daysLeft === 1 ? "" : "s"} remaining</span>
            </div>
          </section>
        )}

        {courses.length > 0 && (
          <section className="sx-row" aria-labelledby="row-courses">
            <header className="sx-rowhead">
              <div>
                <span className="sx-eyebrow">Your library</span>
                <h2 id="row-courses">Your courses</h2>
              </div>
              <span className="sx-count">{courses.length}</span>
            </header>
            <div className="sx-grid">
              {courses.map((c) => (
                <CourseTile key={c.id} course={c} />
              ))}
            </div>
          </section>
        )}

        {!hasContent ? (
          <section className="sx-row">
            <div className="sx-empty">
              <Sparkles size={20} aria-hidden="true" />
              <h3>Nothing assigned yet</h3>
              <p>
                Your admin hasn&apos;t added this account to a batch with courses
                yet. Reach out to them to get started.
              </p>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function monogram(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function tileTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const n = Math.abs(h) % 5;
  return ["violet", "cyan", "rose", "blue", "amber"][n]!;
}

function CourseTile({ course }: { course: DashboardCourse }) {
  return (
    <Link
      href={`/courses/${course.id}`}
      className="sx-tile"
      data-tone={tileTone(course.name)}
    >
      <div className="sx-tile-cover">
        {course.imageUrl ? (
          <img
            src={course.imageUrl}
            alt=""
            className="sx-tile-image"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="sx-tile-monogram">{monogram(course.name)}</span>
        )}
        <span className="sx-tile-badge">
          <BookOpen size={10} aria-hidden="true" />
          Course
        </span>
      </div>
      <div className="sx-tile-body">
        <span className="sx-tile-title">{course.name}</span>
        {course.description ? (
          <p>{course.description}</p>
        ) : (
          <span className="sx-tile-meta">Ready to watch</span>
        )}
      </div>
    </Link>
  );
}

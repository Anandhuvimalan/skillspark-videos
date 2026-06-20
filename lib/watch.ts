/**
 * Shared builder for the student "watch" experience. Used by both the
 * server-rendered page (initial load) and the `GET /api/watch/[videoId]` route
 * handler (in-place video switching). Centralizing it keeps the SSR payload and
 * the swap payload byte-for-byte identical, so navigating between lessons never
 * shifts the layout.
 *
 * Callers MUST authorize first (requireVideoAccess) — this module only reads.
 */

import { prisma } from "@/lib/db";
import { resolveEmbed } from "@/lib/video-provider";
import { buildDriveEmbedUrl, buildDriveDownloadUrl } from "@/lib/drive";

export type LessonNode = { id: string; title: string; duration: number | null };
export type ModuleNode = { id: string; title: string; videos: LessonNode[] };

export type WatchNote = {
  id: string;
  title: string;
  kind: string;
  viewHref: string;
  downloadHref: string | null;
  downloadName: string | null;
};

export type WatchData = {
  course: { id: string; name: string; layout: string } | null;
  tree: { modules: ModuleNode[]; flatLessons: LessonNode[] };
  /** Per-lesson progress for the side rail rings. */
  progress: { videoId: string; lastTimestamp: number; completed: boolean }[];
  current: {
    videoId: string;
    title: string;
    description: string | null;
    duration: number | null;
    moduleTitle: string | null;
    embed: { url: string; streaming: boolean; supportsResume: boolean } | null;
    timestamp: number;
    completed: boolean;
    notes: WatchNote[];
    hasDownloadableNotes: boolean;
    currentIdx: number;
    totalLessons: number;
    prevId: string | null;
    prevTitle: string | null;
    nextId: string | null;
    nextTitle: string | null;
  };
};

function resolveNote(note: {
  id: string;
  title: string;
  sourceType: string;
  driveFileId: string | null;
  externalUrl: string | null;
  uploadPath: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  downloadEnabled: boolean;
}): WatchNote | null {
  if (note.sourceType === "drive" && note.driveFileId) {
    return {
      id: note.id,
      title: note.title,
      kind: "Drive",
      viewHref: buildDriveEmbedUrl(note.driveFileId),
      downloadHref: note.downloadEnabled ? buildDriveDownloadUrl(note.driveFileId) : null,
      downloadName: null,
    };
  }
  if (note.sourceType === "url" && note.externalUrl) {
    return {
      id: note.id,
      title: note.title,
      kind: "Link",
      viewHref: note.externalUrl,
      downloadHref: note.downloadEnabled ? note.externalUrl : null,
      downloadName: note.downloadEnabled ? note.title : null,
    };
  }
  if (note.sourceType === "upload" && note.uploadPath) {
    return {
      id: note.id,
      title: note.title,
      kind: note.mimeType?.includes("pdf") ? "PDF" : "File",
      viewHref: note.uploadPath,
      downloadHref: note.downloadEnabled ? note.uploadPath : null,
      downloadName: note.downloadEnabled ? note.originalFileName ?? note.title : null,
    };
  }
  return null;
}

/**
 * Builds the full watch payload (current video + whole-course side rail).
 * Returns null when the video is missing/inactive. Assumes access checked.
 */
export async function getWatchData(
  studentId: string,
  videoId: string,
): Promise<WatchData | null> {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: {
      module: { include: { course: true } },
      course: true,
      notes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!video || video.status !== "active") return null;

  const parentCourse = video.course ?? video.module?.course ?? null;

  let modules: ModuleNode[] = [];
  let flatLessons: LessonNode[] = [];

  if (parentCourse) {
    if (parentCourse.layout === "flat") {
      flatLessons = await prisma.video.findMany({
        where: { courseId: parentCourse.id, status: "active" },
        orderBy: { videoOrder: "asc" },
        select: { id: true, title: true, duration: true },
      });
    } else {
      const dbModules = await prisma.module.findMany({
        where: { courseId: parentCourse.id },
        orderBy: { moduleOrder: "asc" },
        include: {
          videos: {
            where: { status: "active" },
            orderBy: { videoOrder: "asc" },
            select: { id: true, title: true, duration: true },
          },
        },
      });
      modules = dbModules.map((m) => ({ id: m.id, title: m.title, videos: m.videos }));
    }
  }

  const playOrder: LessonNode[] =
    flatLessons.length > 0 ? flatLessons : modules.flatMap((m) => m.videos);
  const currentIdx = playOrder.findIndex((v) => v.id === video.id);
  const prev = currentIdx > 0 ? playOrder[currentIdx - 1] : null;
  const next =
    currentIdx >= 0 && currentIdx < playOrder.length - 1 ? playOrder[currentIdx + 1] : null;

  const allLessonIds = playOrder.map((l) => l.id);
  const progressRows = allLessonIds.length
    ? await prisma.videoProgress.findMany({
        where: { studentId, videoId: { in: allLessonIds } },
        select: { videoId: true, lastTimestamp: true, completed: true },
      })
    : [];

  const currentProgress =
    progressRows.find((p) => p.videoId === video.id) ?? null;

  const embed = resolveEmbed({ driveFileId: video.driveFileId, videoId: video.id });

  const notes = video.notes
    .map(resolveNote)
    .filter((n): n is WatchNote => n !== null);

  return {
    course: parentCourse
      ? { id: parentCourse.id, name: parentCourse.name, layout: parentCourse.layout }
      : null,
    tree: { modules, flatLessons },
    progress: progressRows,
    current: {
      videoId: video.id,
      title: video.title,
      description: video.description,
      duration: video.duration,
      moduleTitle: video.module?.title ?? null,
      embed: embed
        ? { url: embed.url, streaming: embed.streaming, supportsResume: embed.supportsResume }
        : null,
      timestamp: currentProgress?.lastTimestamp ?? 0,
      completed: currentProgress?.completed ?? false,
      notes,
      hasDownloadableNotes: notes.some((n) => n.downloadHref !== null),
      currentIdx,
      totalLessons: playOrder.length,
      prevId: prev?.id ?? null,
      prevTitle: prev?.title ?? null,
      nextId: next?.id ?? null,
      nextTitle: next?.title ?? null,
    },
  };
}

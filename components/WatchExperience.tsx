"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Download,
  Eye,
  FileText,
  Package,
  Play,
  PlayCircle,
} from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import type { WatchData, LessonNode, WatchNote } from "@/lib/watch";

function formatDuration(s: number): string | null {
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

// Cap the per-session payload cache so a very long course can't grow it without
// bound. Courses are typically well under this; eviction is FIFO and never
// touches the lesson currently on screen.
const MAX_CACHE = 60;

export default function WatchExperience({ initial }: { initial: WatchData }) {
  const [data, setData] = useState<WatchData>(initial);
  const [pending, setPending] = useState(false);
  // The lesson the user just clicked, surfaced as "active" in the rail the
  // instant they click — even on a cache miss, before the payload lands — so a
  // click never feels unregistered.
  const [optimisticId, setOptimisticId] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  // Blocks overlapping in-place navigations (e.g. a fast double-tap on Next)
  // from racing each other.
  const navLockRef = useRef(false);

  // Session-scoped payload memoization. Every lesson in a course shares the same
  // tree/progress and students revisit lessons, so caching the payload makes
  // repeat and prefetched navigations instant (zero network). `inflight` dedupes
  // concurrent fetches/prefetches for the same lesson.
  const cacheRef = useRef<Map<string, WatchData>>(
    new Map([[initial.current.videoId, initial]]),
  );
  const inflightRef = useRef<Map<string, Promise<WatchData | null>>>(new Map());

  // Sync only on a genuine navigation to a *different* lesson (initial load, or
  // a real server navigation back into this route). If the server re-renders
  // this same route and hands back a fresh `initial` for the lesson already on
  // screen, we keep our live client state untouched — swapping it would reset
  // the player and re-seek mid-playback. This guards in-place playback against
  // any stray route refresh.
  useEffect(() => {
    cacheRef.current.set(initial.current.videoId, initial);
    setData((prev) =>
      prev.current.videoId === initial.current.videoId ? prev : initial,
    );
  }, [initial]);

  // Fetch (and memoize) a lesson payload, deduping concurrent requests. Returns
  // null on access-loss / network failure so callers can fall back to a real
  // navigation. Never throws.
  const fetchPayload = useCallback(
    async (videoId: string): Promise<WatchData | null> => {
      const cached = cacheRef.current.get(videoId);
      if (cached) return cached;
      const existing = inflightRef.current.get(videoId);
      if (existing) return existing;

      const p = (async (): Promise<WatchData | null> => {
        try {
          const res = await fetch(`/api/watch/${encodeURIComponent(videoId)}`, {
            cache: "no-store",
            headers: { accept: "application/json" },
          });
          if (!res.ok) return null;
          const payload = (await res.json()) as WatchData;
          const cache = cacheRef.current;
          cache.set(videoId, payload);
          // FIFO eviction, but never drop the lesson currently on screen.
          while (cache.size > MAX_CACHE) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined || oldest === dataRef.current.current.videoId) break;
            cache.delete(oldest);
          }
          return payload;
        } catch {
          return null;
        } finally {
          inflightRef.current.delete(videoId);
        }
      })();
      inflightRef.current.set(videoId, p);
      return p;
    },
    [],
  );

  // Predictive prefetch — warm a lesson's payload into cache before it's needed
  // (hover/focus on the rail, or the adjacent next/prev). Fire-and-forget; the
  // cache + inflight guards make repeat calls free.
  const prefetch = useCallback(
    (videoId?: string | null) => {
      if (!videoId) return;
      if (cacheRef.current.has(videoId) || inflightRef.current.has(videoId)) return;
      void fetchPayload(videoId);
    },
    [fetchPayload],
  );

  const applyPayload = useCallback(
    (payload: WatchData, targetId: string, push: boolean) => {
      setData(payload);
      setOptimisticId(null);
      if (push) {
        window.history.pushState({ videoId: targetId }, "", `/videos/${targetId}`);
      }
      // Bring the player into view if the click came from far down the rail.
      if (typeof window !== "undefined" && window.scrollY > 200) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [],
  );

  // Core in-place swap. On a cache hit it swaps synchronously (instant, no
  // spinner); on a miss it shows the optimistic rail highlight immediately and
  // loads the payload via a plain route handler (NOT a Server Action) so there
  // is zero App Router churn — never a full page reload. `push` controls whether
  // a new history entry is created (false for back/forward, which already moved).
  const swap = useCallback(
    async (targetId: string, push: boolean) => {
      if (!targetId || targetId === dataRef.current.current.videoId) return;
      if (navLockRef.current) return;
      navLockRef.current = true;

      // Instant path — payload already cached (revisit or prefetched).
      const cached = cacheRef.current.get(targetId);
      if (cached) {
        applyPayload(cached, targetId, push);
        navLockRef.current = false;
        return;
      }

      // Cache miss — register the click visually, then load.
      setOptimisticId(targetId);
      setPending(true);
      try {
        const payload = await fetchPayload(targetId);
        if (payload) {
          applyPayload(payload, targetId, push);
        } else {
          // Access lost or video gone — hand off to a real navigation so the
          // server can 403 / 404 / redirect authoritatively.
          window.location.assign(`/videos/${targetId}`);
        }
      } finally {
        navLockRef.current = false;
        setPending(false);
      }
    },
    [applyPayload, fetchPayload],
  );

  // Rail / prev-next clicks: swap in place and push a tagged history entry.
  const navigate = useCallback(
    (targetId: string) => {
      void swap(targetId, true);
    },
    [swap],
  );

  // Warm the adjacent lessons as soon as a video becomes current — "next" is the
  // single most likely click, and prev covers back-tracking.
  useEffect(() => {
    prefetch(data.current.nextId);
    prefetch(data.current.prevId);
  }, [data.current.videoId, data.current.nextId, data.current.prevId, prefetch]);

  // Browser back/forward: read the lesson id from the popped entry (or the URL)
  // and swap in place, so history navigation stays a clean DOM update too.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const stateId =
        e.state && typeof e.state === "object" && "videoId" in e.state
          ? String((e.state as { videoId?: unknown }).videoId ?? "")
          : "";
      const m = window.location.pathname.match(/^\/videos\/([^/]+)\/?$/);
      const target = stateId || (m ? decodeURIComponent(m[1]!) : "");
      // Only handle in-route lesson swaps; let the router own anything else.
      if (target && target !== dataRef.current.current.videoId) {
        void swap(target, false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [swap]);

  const { course, tree, current } = data;
  const progressMap = new Map(
    data.progress.map((p) => [p.videoId, { lastTimestamp: p.lastTimestamp, completed: p.completed }]),
  );
  const totalLessons = current.totalLessons;
  // While a cache-miss load is in flight, show the just-clicked lesson as the
  // active one so the rail reacts to the click instantly.
  const activeId = optimisticId ?? current.videoId;

  return (
    <main className="sx-watch" id="main-content" aria-busy={pending}>
      <Link
        href={course ? `/courses/${course.id}` : "/dashboard"}
        className="sx-back"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {course ? `Back to ${course.name}` : "Back to dashboard"}
      </Link>

      <div className="sx-watch-grid" data-pending={pending ? "true" : undefined}>
        <div className="sx-watch-main">
          {current.embed ? (
            <VideoPlayer
              key={current.videoId}
              videoId={current.videoId}
              src={current.embed.url}
              streaming={current.embed.streaming}
              initialTimestamp={current.timestamp}
              hasPrev={!!current.prevId}
              hasNext={!!current.nextId}
              prevTitle={current.prevTitle}
              nextTitle={current.nextTitle}
              onPrev={current.prevId ? () => navigate(current.prevId!) : undefined}
              onNext={current.nextId ? () => navigate(current.nextId!) : undefined}
            />
          ) : (
            <p className="sx-empty-note">
              <strong>Video not available.</strong>
            </p>
          )}

          <header className="sx-watch-info">
            {current.moduleTitle ? (
              <span className="sx-eyebrow">{current.moduleTitle}</span>
            ) : null}
            <h1>{current.title}</h1>
            <div className="sx-watch-meta">
              <span>
                <Clock size={13} aria-hidden="true" />
                {formatDuration(current.duration ?? 0) ?? "Duration pending"}
              </span>
              {current.currentIdx >= 0 ? (
                <span>
                  <PlayCircle size={13} aria-hidden="true" />
                  Lesson {current.currentIdx + 1} of {totalLessons}
                </span>
              ) : null}
              {current.timestamp && formatDuration(current.timestamp) ? (
                <span className="sx-watch-resume">
                  Resume {formatDuration(current.timestamp)}
                </span>
              ) : null}
            </div>
            {current.description ? <p>{current.description}</p> : null}
          </header>

          {current.timestamp && current.embed && !current.embed.supportsResume ? (
            <p className="sx-note-banner">
              Drive iframe does not support auto-resume; ask admin to set
              GOOGLE_DRIVE_API_KEY.
            </p>
          ) : null}

          {current.notes.length > 0 && (
            <section className="sx-notes" aria-labelledby="notes-heading">
              <header className="sx-rowhead">
                <div>
                  <span className="sx-eyebrow">
                    <FileText size={12} aria-hidden="true" />
                    Resources
                  </span>
                  <h2 id="notes-heading">Notes &amp; references</h2>
                </div>
                <div className="sx-rowhead-actions">
                  <span className="sx-count">{current.notes.length}</span>
                  {current.hasDownloadableNotes ? (
                    <a
                      className="sx-btn sx-btn--ghost sx-btn--sm"
                      href={`/api/videos/${current.videoId}/notes-zip`}
                    >
                      <Package size={14} aria-hidden="true" />
                      Download all (.zip)
                    </a>
                  ) : null}
                </div>
              </header>
              <div className="sx-notes-grid">
                {current.notes.map((note) => (
                  <NoteCard key={note.id} note={note} />
                ))}
              </div>
            </section>
          )}
        </div>

        {totalLessons > 1 && (
          <aside className="sx-rail" aria-label="Course contents">
            <div className="sx-rail-head">
              <div>
                <span className="sx-eyebrow">Course content</span>
                {course ? (
                  <strong className="sx-rail-title">{course.name}</strong>
                ) : null}
              </div>
              <span className="sx-count">{totalLessons}</span>
            </div>
            {tree.flatLessons.length > 0 ? (
              <ol className="sx-rail-list">
                {tree.flatLessons.map((l, i) => (
                  <TreeLesson
                    key={l.id}
                    lesson={l}
                    index={i}
                    isCurrent={l.id === activeId}
                    progress={progressMap.get(l.id) ?? null}
                    onNavigate={navigate}
                    onPrefetch={prefetch}
                  />
                ))}
              </ol>
            ) : (
              <div className="sx-rail-mods">
                {tree.modules.map((m, mi) => {
                  const containsCurrent = m.videos.some((v) => v.id === current.videoId);
                  const moduleDone =
                    m.videos.length > 0 &&
                    m.videos.every((v) => progressMap.get(v.id)?.completed);
                  const totalSecs = m.videos.reduce((s, v) => s + (v.duration ?? 0), 0);
                  return (
                    <details
                      key={m.id}
                      className="sx-rail-mod"
                      data-current={containsCurrent ? "true" : undefined}
                      data-complete={moduleDone ? "true" : undefined}
                      open={containsCurrent}
                    >
                      <summary>
                        <span className="sx-rail-mod-num">
                          {String(mi + 1).padStart(2, "0")}
                        </span>
                        <span className="sx-rail-mod-info">
                          <span className="sx-rail-mod-title">{m.title}</span>
                          <span className="sx-rail-mod-meta">
                            {m.videos.length} lesson{m.videos.length === 1 ? "" : "s"}
                            {formatDuration(totalSecs) ? ` · ${formatDuration(totalSecs)}` : ""}
                          </span>
                        </span>
                        <ChevronDown
                          className="sx-rail-mod-chev"
                          size={16}
                          strokeWidth={2.4}
                          aria-hidden="true"
                        />
                      </summary>
                      <ol className="sx-rail-list">
                        {m.videos.map((l, li) => (
                          <TreeLesson
                            key={l.id}
                            lesson={l}
                            index={li}
                            isCurrent={l.id === activeId}
                            progress={progressMap.get(l.id) ?? null}
                            onNavigate={navigate}
                            onPrefetch={prefetch}
                          />
                        ))}
                      </ol>
                    </details>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}

function TreeLesson({
  lesson,
  index,
  isCurrent,
  progress,
  onNavigate,
  onPrefetch,
}: {
  lesson: LessonNode;
  index: number;
  isCurrent: boolean;
  progress: { lastTimestamp: number; completed: boolean } | null;
  onNavigate: (id: string) => void;
  onPrefetch: (id: string) => void;
}) {
  const completed = progress?.completed === true;
  const ratio = completed
    ? 1
    : progress && lesson.duration && lesson.duration > 0
      ? Math.min(1, progress.lastTimestamp / lesson.duration)
      : 0;
  return (
    <li
      data-current={isCurrent ? "true" : undefined}
      data-completed={completed ? "true" : undefined}
    >
      <a
        href={`/videos/${lesson.id}`}
        className="sx-rail-row"
        aria-current={isCurrent ? "true" : undefined}
        // Warm the payload on intent (hover/focus) so the click is instant.
        onMouseEnter={() => onPrefetch(lesson.id)}
        onFocus={() => onPrefetch(lesson.id)}
        onClick={(e) => {
          // Let modified clicks (new tab) behave natively.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onNavigate(lesson.id);
        }}
      >
        <span className="sx-rail-icon" aria-hidden="true">
          {completed ? (
            <Check size={11} strokeWidth={2.8} />
          ) : isCurrent ? (
            <span className="sx-rail-pulse" />
          ) : (
            <Play size={10} strokeWidth={2.4} fill="currentColor" />
          )}
        </span>
        <span className="sx-rail-num">{String(index + 1).padStart(2, "0")}</span>
        <span className="sx-rail-lesson">{lesson.title}</span>
        <span className="sx-rail-dur">
          {formatDuration(lesson.duration ?? 0) ?? "—"}
        </span>
        {ratio > 0 && ratio < 1 ? (
          <span className="sx-rail-bar" aria-hidden="true">
            <span style={{ width: `${ratio * 100}%` }} />
          </span>
        ) : null}
      </a>
    </li>
  );
}

function NoteCard({ note }: { note: WatchNote }) {
  return (
    <article className="sx-note">
      <div className="sx-note-head">
        <span className="sx-note-kind">
          <FileText size={11} aria-hidden="true" />
          {note.kind}
        </span>
        <span className="sx-note-title">{note.title}</span>
      </div>
      <div className="sx-note-actions">
        <a
          className="sx-note-link"
          href={note.viewHref}
          target="_blank"
          rel="noreferrer"
        >
          <Eye size={13} aria-hidden="true" />
          View
        </a>
        {note.downloadHref ? (
          <a
            className="sx-note-link sx-note-link--download"
            href={note.downloadHref}
            target="_blank"
            rel="noreferrer"
            download={note.downloadName ?? true}
          >
            <Download size={13} aria-hidden="true" />
            Download
          </a>
        ) : null}
      </div>
    </article>
  );
}

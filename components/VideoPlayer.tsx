"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Persist progress via a route handler (NOT a Server Action). Server Actions
 * re-render the route's RSC on every call, which would re-feed `initial` to the
 * watch shell and make the player re-seek mid-playback. `keepalive` lets the
 * request survive a tab close. Best-effort: failures are swallowed.
 */
function postProgress(videoId: string, t: number, completed?: boolean) {
  try {
    void fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId,
        lastTimestamp: t,
        ...(completed !== undefined ? { completed } : {}),
      }),
      keepalive: true,
      cache: "no-store",
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

type Props = {
  videoId: string;
  /** When `streaming` is true, this is the proxy URL to feed an HTML5 <video>. */
  src: string;
  streaming: boolean;
  initialTimestamp: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevTitle?: string | null;
  nextTitle?: string | null;
  /** Called to switch lessons in place (no reload). Owned by the watch shell. */
  onPrev?: () => void;
  onNext?: () => void;
};

/**
 * HTML5 video player when the provider supports resume (server-proxied Drive
 * stream). We lean on the browser's NATIVE controls + native loading indicator
 * — no custom play button or spinner overlay — and only add the behaviour the
 * native element can't do on its own: resume-seek, progress capture, autoplay
 * on lesson select, and an end-of-video "up next" auto-advance.
 *
 * Falls back to a plain Drive iframe when streaming isn't available (no
 * programmatic currentTime, so progress/resume are skipped there).
 */
const STORAGE_KEY = (videoId: string) => `lms:video-progress:${videoId}`;

function readLocal(videoId: string): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(videoId));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj?.t === "number" && Number.isFinite(obj.t) && obj.t >= 0) {
      return Math.floor(obj.t);
    }
    return null;
  } catch {
    return null;
  }
}

function writeLocal(videoId: string, t: number) {
  try {
    localStorage.setItem(STORAGE_KEY(videoId), JSON.stringify({ t, at: Date.now() }));
  } catch {
    /* localStorage unavailable / full — ignore */
  }
}

function beacon(videoId: string, t: number) {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
  try {
    navigator.sendBeacon(
      "/api/progress/beacon",
      new Blob([JSON.stringify({ videoId, lastTimestamp: t })], {
        type: "application/json",
      }),
    );
  } catch {
    /* ignore */
  }
}

export default function VideoPlayer({
  videoId,
  src,
  streaming,
  initialTimestamp,
  hasNext,
  onNext,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const cancelRef = useRef(false);

  // Keep the latest onNext in a ref so the progress effect (which only runs on
  // videoId change) always calls the current callback on auto-advance.
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  // -- Progress tracking + auto-advance (streaming only) ------------------
  useEffect(() => {
    if (!streaming) return;
    const v = videoRef.current;
    if (!v) return;

    let lastSavedAt = 0;
    let lastSavedTs = -1;
    let didSeek = false;

    const flushServer = (final: boolean, completed?: boolean) => {
      const t = Math.floor(v.currentTime);
      if (!Number.isFinite(t) || t < 0) return;
      writeLocal(videoId, t);
      const now = Date.now();
      if (!final && Math.abs(t - lastSavedTs) < 5 && now - lastSavedAt < 5_000) {
        return;
      }
      lastSavedTs = t;
      lastSavedAt = now;
      postProgress(videoId, t, completed);
    };

    const onLoadedMetadata = () => {
      if (didSeek) return;
      didSeek = true;
      const local = readLocal(videoId);
      const candidate = Math.max(initialTimestamp, local ?? 0);
      if (candidate <= 0) return;
      const max = Number.isFinite(v.duration) && v.duration > 0 ? v.duration - 2 : candidate;
      const target = Math.min(candidate, Math.max(0, max));
      try {
        v.currentTime = target;
      } catch {
        /* ignore */
      }
    };

    const onTimeUpdate = () => {
      const t = Math.floor(v.currentTime);
      if (Number.isFinite(t) && t >= 0) writeLocal(videoId, t);
      flushServer(false);
    };
    const onPause = () => flushServer(true);
    const onSeeked = () => flushServer(true);
    const onEnded = () => {
      flushServer(true, true);
      if (onNextRef.current) {
        cancelRef.current = false;
        let n = 5;
        setCountdown(n);
        const tick = window.setInterval(() => {
          if (cancelRef.current) {
            window.clearInterval(tick);
            return;
          }
          n -= 1;
          if (n <= 0) {
            window.clearInterval(tick);
            setCountdown(null);
            onNextRef.current?.();
          } else {
            setCountdown(n);
          }
        }, 1000);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        const t = Math.floor(v.currentTime);
        writeLocal(videoId, t);
        beacon(videoId, t);
        flushServer(true);
      }
    };
    const onPageHide = () => {
      const t = Math.floor(v.currentTime);
      if (!Number.isFinite(t) || t < 0) return;
      writeLocal(videoId, t);
      beacon(videoId, t);
    };
    const onBeforeUnload = onPageHide;

    v.addEventListener("loadedmetadata", onLoadedMetadata);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    if (v.readyState >= 1 /* HAVE_METADATA */) onLoadedMetadata();

    return () => {
      v.removeEventListener("loadedmetadata", onLoadedMetadata);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      const t = Math.floor(v.currentTime);
      if (Number.isFinite(t) && t >= 0) {
        writeLocal(videoId, t);
        beacon(videoId, t);
      }
    };
  }, [videoId, streaming, initialTimestamp]);

  // -- Autoplay on select + hard-error surface (streaming only) -----------
  // Selecting a lesson (rail tap / "play next") happens in-document, so the
  // page holds sticky user activation and play() is allowed — both for the
  // chosen video and for the auto-advanced next one. On a cold first load with
  // no prior interaction the browser may block it; we swallow that and the
  // native controls remain. A genuine media error shows a retry.
  useEffect(() => {
    if (!streaming) return;
    const v = videoRef.current;
    if (!v) return;
    setLoadError(false);
    // Start playback as early as correctly possible. `loadedmetadata` is the
    // first point at which the resume-seek (run by the progress effect on the
    // same event, attached earlier so it fires first) has set currentTime, so we
    // play from the right spot without waiting for the later `canplay`. play()
    // resolves once playback actually begins, so calling it before data is fully
    // buffered just means "play the moment you can." Repeated calls are no-ops.
    const tryPlay = () => {
      void v.play().catch(() => {});
    };
    const onError = () => setLoadError(true);
    v.addEventListener("loadedmetadata", tryPlay);
    v.addEventListener("loadeddata", tryPlay);
    v.addEventListener("canplay", tryPlay);
    v.addEventListener("error", onError);
    if (v.readyState >= 1 /* HAVE_METADATA */) tryPlay();
    return () => {
      v.removeEventListener("loadedmetadata", tryPlay);
      v.removeEventListener("loadeddata", tryPlay);
      v.removeEventListener("canplay", tryPlay);
      v.removeEventListener("error", onError);
    };
  }, [videoId, streaming]);

  const retry = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setLoadError(false);
    try {
      v.load();
      void v.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  const nextOverlay =
    countdown !== null && hasNext ? (
      <div className="sx-nextup" role="status" aria-live="polite">
        <span className="sx-nextup-label">Up next in</span>
        <span className="sx-nextup-count">{countdown}</span>
        <div className="sx-nextup-actions">
          <button
            type="button"
            className="sx-btn sx-btn--ghost-dark"
            onClick={() => {
              cancelRef.current = true;
              setCountdown(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sx-btn sx-btn--paper"
            onClick={() => {
              cancelRef.current = true;
              setCountdown(null);
              onNext?.();
            }}
          >
            Play next now
          </button>
        </div>
      </div>
    ) : null;

  if (streaming) {
    return (
      <div className="sx-player">
        <video
          ref={videoRef}
          src={src}
          controls
          controlsList="nodownload"
          disablePictureInPicture
          preload="auto"
          autoPlay
          playsInline
        />
        {loadError ? (
          <div className="sx-player-error" role="alert">
            <p>This lesson didn&apos;t load.</p>
            <button type="button" className="sx-btn sx-btn--paper" onClick={retry}>
              Try again
            </button>
          </div>
        ) : null}
        {nextOverlay}
      </div>
    );
  }
  // Fallback: Drive iframe with its own controls, no progress tracking.
  return (
    <div className="sx-player">
      <iframe
        src={src}
        allow="autoplay"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

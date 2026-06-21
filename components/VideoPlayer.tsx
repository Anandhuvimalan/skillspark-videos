"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "lucide-react";
const SKIP_SECONDS = 10;

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
 * stream). Real `currentTime` lets us seek to the saved position and capture
 * accurate progress. Falls back to a plain Drive iframe when streaming isn't
 * available — in that mode we cannot read currentTime, so we skip auto-progress.
 *
 * Navigation is delegated to `onPrev`/`onNext` so the parent shell can swap the
 * lesson in place. The prev/next overlay arrows auto-hide ~3s after playback
 * starts and reappear on pause or pointer movement.
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

const HIDE_AFTER_MS = 2000;

export default function VideoPlayer({
  videoId,
  src,
  streaming,
  initialTimestamp,
  hasPrev,
  hasNext,
  prevTitle,
  nextTitle,
  onPrev,
  onNext,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Controls the visibility of all overlay chrome (edge nav + center cluster).
  const [chromeVisible, setChromeVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  // Starts true so the spinner is on screen the instant the element mounts
  // (i.e. the moment a lesson swap remounts the player), before any byte lands.
  const [buffering, setBuffering] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const cancelRef = useRef(false);
  // Debounces the spinner on mid-playback stalls so brief `waiting` blips don't
  // flash a loader over a video that's actually playing.
  const stallTimerRef = useRef<number | undefined>(undefined);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, []);

  const skip = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(dur, v.currentTime + delta));
  }, []);

  // Keep the latest onNext in a ref so the progress effect (which only runs on
  // videoId change) always calls the current callback on auto-advance.
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  // -- Progress tracking (streaming only) ---------------------------------
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

  // -- Buffering / error overlay (streaming only) --------------------------
  // A bare <video> renders only a black rectangle while it connects to the
  // proxy and buffers, so a lesson swap reads as a dead click. Drive a spinner
  // off the element's readiness events. Two rules kill the "playing but still
  // loading" glitch: (1) any real progress (`timeupdate`/`playing`/`canplay`)
  // hides it instantly; (2) a stall only shows the spinner if it lasts ~350ms,
  // so a momentary re-buffer that resolves on the next frame never flashes.
  useEffect(() => {
    if (!streaming) {
      setBuffering(false);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    setLoadError(false);

    const clearStall = () => {
      if (stallTimerRef.current) {
        window.clearTimeout(stallTimerRef.current);
        stallTimerRef.current = undefined;
      }
    };
    const ready = () => {
      clearStall();
      setBuffering(false);
    };
    const stall = () => {
      clearStall();
      stallTimerRef.current = window.setTimeout(() => setBuffering(true), 350);
    };
    const fail = () => {
      clearStall();
      setLoadError(true);
      setBuffering(false);
    };

    v.addEventListener("loadeddata", ready);
    v.addEventListener("canplay", ready);
    v.addEventListener("canplaythrough", ready);
    v.addEventListener("playing", ready);
    v.addEventListener("timeupdate", ready);
    v.addEventListener("seeked", ready);
    v.addEventListener("waiting", stall);
    v.addEventListener("seeking", stall);
    v.addEventListener("error", fail);
    // On (re)mount show the spinner immediately only if not yet playable — the
    // expected case on a fresh load. If it's already buffered, stay clean.
    setBuffering(v.readyState < 3 /* HAVE_FUTURE_DATA */);

    return () => {
      clearStall();
      v.removeEventListener("loadeddata", ready);
      v.removeEventListener("canplay", ready);
      v.removeEventListener("canplaythrough", ready);
      v.removeEventListener("playing", ready);
      v.removeEventListener("timeupdate", ready);
      v.removeEventListener("seeked", ready);
      v.removeEventListener("waiting", stall);
      v.removeEventListener("seeking", stall);
      v.removeEventListener("error", fail);
    };
  }, [videoId, streaming]);

  const retry = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setLoadError(false);
    setBuffering(true);
    try {
      v.load();
    } catch {
      /* ignore */
    }
  }, []);

  // -- Auto-hiding overlay chrome (edge nav + center play/skip) ------------
  useEffect(() => {
    if (!streaming && !hasPrev && !hasNext) return;
    const frame = frameRef.current;
    if (!frame) return;

    let hideTimer: number | undefined;
    let isPlaying = false;
    const clearTimer = () => {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
      }
    };
    // Streaming: only auto-hide while actually playing (so a paused player keeps
    // the big play button on screen). Iframe: we can't read playback state, so
    // auto-hide on pointer inactivity.
    const shouldAutoHide = () => (streaming ? isPlaying : true);
    // Never fade chrome out from under a cursor that's parked on a control.
    const chromeHovered = () =>
      !!frame.querySelector(".sx-player-edge:hover, .sx-ctl:hover");
    const scheduleHide = () => {
      clearTimer();
      if (shouldAutoHide()) {
        hideTimer = window.setTimeout(() => {
          if (chromeHovered()) {
            scheduleHide();
            return;
          }
          setChromeVisible(false);
        }, HIDE_AFTER_MS);
      }
    };
    const reveal = () => {
      setChromeVisible(true);
      scheduleHide();
    };

    const onMove = () => reveal();
    const onLeave = () => {
      if (shouldAutoHide() && !chromeHovered()) setChromeVisible(false);
    };
    frame.addEventListener("mousemove", onMove);
    frame.addEventListener("touchstart", onMove, { passive: true });
    frame.addEventListener("mouseleave", onLeave);

    const v = videoRef.current;
    let onPlay: (() => void) | undefined;
    let onPause: (() => void) | undefined;
    if (streaming && v) {
      onPlay = () => {
        isPlaying = true;
        setPlaying(true);
        reveal(); // show, then fade after HIDE_AFTER_MS
      };
      onPause = () => {
        isPlaying = false;
        setPlaying(false);
        clearTimer();
        setChromeVisible(true);
      };
      v.addEventListener("play", onPlay);
      v.addEventListener("playing", onPlay);
      v.addEventListener("pause", onPause);
      v.addEventListener("ended", onPause);
      setPlaying(!v.paused && !v.ended);
    }

    // Start visible; if iframe, fade after the initial window.
    reveal();

    return () => {
      clearTimer();
      frame.removeEventListener("mousemove", onMove);
      frame.removeEventListener("touchstart", onMove);
      frame.removeEventListener("mouseleave", onLeave);
      if (streaming && v) {
        if (onPlay) {
          v.removeEventListener("play", onPlay);
          v.removeEventListener("playing", onPlay);
        }
        if (onPause) {
          v.removeEventListener("pause", onPause);
          v.removeEventListener("ended", onPause);
        }
      }
    };
  }, [videoId, streaming, hasPrev, hasNext]);

  // Effective chrome visibility. Folding `buffering`/`loadError` in here (rather
  // than mounting/unmounting the controls) means the edge + center clusters fade
  // via CSS instead of popping in and out — no glitchy flicker on load, and the
  // controls never overlap the spinner.
  const chromeShown = chromeVisible && !buffering && !loadError;

  const overlayNav = (
    <>
      {hasPrev ? (
        <button
          type="button"
          onClick={() => onPrev?.()}
          className="sx-player-edge sx-player-edge--prev"
          title={prevTitle ? `Previous: ${prevTitle}` : "Previous lesson"}
          aria-label={prevTitle ? `Previous lesson: ${prevTitle}` : "Previous lesson"}
        >
          <ChevronLeft size={24} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          onClick={() => onNext?.()}
          className="sx-player-edge sx-player-edge--next"
          title={nextTitle ? `Up next: ${nextTitle}` : "Next lesson"}
          aria-label={nextTitle ? `Next lesson: ${nextTitle}` : "Next lesson"}
        >
          <ChevronRight size={24} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );

  // Netflix-style center cluster: 10s rewind, big play/pause, 10s forward.
  // Streaming only — the Drive iframe has its own controls we can't drive.
  const centerControls = (
    <div className="sx-ctls" aria-hidden={!chromeShown}>
      <button
        type="button"
        className="sx-ctl sx-ctl--skip"
        onClick={() => skip(-SKIP_SECONDS)}
        aria-label={`Rewind ${SKIP_SECONDS} seconds`}
        title={`Rewind ${SKIP_SECONDS}s`}
        tabIndex={chromeShown ? 0 : -1}
      >
        <RotateCcw size={26} strokeWidth={2.2} aria-hidden="true" />
        <span className="sx-ctl-sec">{SKIP_SECONDS}</span>
      </button>
      <button
        type="button"
        className="sx-ctl sx-ctl--play"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
        tabIndex={chromeShown ? 0 : -1}
      >
        {playing ? (
          <Pause size={30} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
        ) : (
          <Play size={30} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="sx-ctl sx-ctl--skip"
        onClick={() => skip(SKIP_SECONDS)}
        aria-label={`Forward ${SKIP_SECONDS} seconds`}
        title={`Forward ${SKIP_SECONDS}s`}
        tabIndex={chromeShown ? 0 : -1}
      >
        <RotateCw size={26} strokeWidth={2.2} aria-hidden="true" />
        <span className="sx-ctl-sec">{SKIP_SECONDS}</span>
      </button>
    </div>
  );

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
      <div
        ref={frameRef}
        className="sx-player"
        data-has-edges={hasPrev || hasNext ? "true" : undefined}
        data-chrome-visible={chromeShown ? "true" : "false"}
      >
        <video
          ref={videoRef}
          src={src}
          controls
          controlsList="nodownload"
          disablePictureInPicture
          preload="auto"
          playsInline
        />
        {buffering && !loadError ? (
          <div className="sx-player-loading" aria-hidden="true">
            <span className="sx-player-spinner" />
          </div>
        ) : null}
        {loadError ? (
          <div className="sx-player-error" role="alert">
            <p>This lesson didn&apos;t load.</p>
            <button type="button" className="sx-btn sx-btn--paper" onClick={retry}>
              Try again
            </button>
          </div>
        ) : null}
        {/* Mounted whenever there's no error/up-next overlay; CSS fades it via
            data-chrome-visible so it never pops in/out or overlaps the spinner. */}
        {countdown === null && !loadError ? centerControls : null}
        {overlayNav}
        {nextOverlay}
      </div>
    );
  }
  // Fallback: Drive iframe, no progress tracking.
  return (
    <div
      ref={frameRef}
      className="sx-player"
      data-has-edges={hasPrev || hasNext ? "true" : undefined}
      data-chrome-visible={chromeShown ? "true" : "false"}
    >
      <iframe
        src={src}
        allow="autoplay"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
      {overlayNav}
    </div>
  );
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  requireStudent,
  requireVideoAccess,
  AuthError,
} from "@/lib/authorization";
import { hasDriveAuth } from "@/lib/drive";
import { getDriveAccessToken } from "@/lib/drive-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Auth-gated proxy that streams a Drive file's bytes through our server so an
 * HTML5 <video> element can play it with real currentTime / seeking.
 *
 * Forwards the client's `Range` header to Drive's `?alt=media` endpoint and
 * passes Drive's response headers back (Content-Type, Content-Length,
 * Content-Range, Accept-Ranges). 206 partial responses make seek work.
 *
 * Auth strategy (in order of preference):
 *   1. GOOGLE_SERVICE_ACCOUNT_JSON  — works for restricted files shared with
 *                                     the service-account email.
 *   2. GOOGLE_DRIVE_API_KEY         — works only for "anyone with link" files.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch (e) {
    if (e instanceof AuthError) return new NextResponse(null, { status: e.status });
    throw e;
  }
  const { videoId } = await params;
  try {
    await requireVideoAccess(student.id, videoId);
  } catch (e) {
    if (e instanceof AuthError) return new NextResponse(null, { status: e.status });
    throw e;
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { driveFileId: true, status: true },
  });
  if (!video || video.status !== "active") {
    return new NextResponse(null, { status: 404 });
  }

  if (!hasDriveAuth()) {
    return new NextResponse(
      "Drive auth not configured (set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_API_KEY)",
      { status: 503 },
    );
  }

  const driveUrl = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(video.driveFileId)}`,
  );
  driveUrl.searchParams.set("alt", "media");
  driveUrl.searchParams.set("supportsAllDrives", "true");

  const headers = new Headers();
  const range = req.headers.get("range");
  if (range) headers.set("Range", range);

  const token = await getDriveAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
    if (!apiKey) return new NextResponse(null, { status: 503 });
    driveUrl.searchParams.set("key", apiKey);
  }

  const upstream = await fetch(driveUrl.toString(), {
    method: "GET",
    headers,
    // Drive sometimes 302s media to a googleusercontent.com URL — follow it.
    redirect: "follow",
    cache: "no-store",
  });

  if (!upstream.ok && upstream.status !== 206) {
    if (upstream.status === 401 || upstream.status === 403) {
      console.warn(
        `[stream] Drive ${upstream.status} for fileId=${video.driveFileId} — is it shared with the service account?`,
      );
    }
    return new NextResponse(null, { status: upstream.status });
  }

  // Mirror the headers needed for video playback + range seeking.
  const out = new Headers();
  for (const k of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "last-modified",
    "etag",
  ]) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  // Allow the student's OWN browser to cache these bytes (never a shared/CDN
  // cache). This makes predictive prefetch of the next lesson actually instant
  // and makes seeking/replays cheap, without weakening access control: every
  // request is still auth-gated, and `private` keeps the cache per-browser. The
  // forwarded ETag/Last-Modified let the browser revalidate after the window.
  // Consistent with the project's honest-security model (no download button,
  // no driveFileId exposure — content the student can already watch).
  out.set("cache-control", "private, max-age=3600");
  out.set("content-disposition", "inline");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

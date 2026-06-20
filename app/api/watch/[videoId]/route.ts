import { NextResponse } from "next/server";
import {
  requireStudent,
  requireVideoAccess,
  AuthError,
} from "@/lib/authorization";
import { getWatchData } from "@/lib/watch";

/**
 * In-place lesson-swap payload for the student watch shell.
 *
 * Why a route handler and not the `loadWatchPayload` Server Action:
 *   Server Actions in the App Router re-render the current route's Server
 *   Components on every call. The watch shell swaps lessons client-side and
 *   updates the URL with `history.pushState`; pairing that manual history entry
 *   with a Server-Action-triggered RSC refresh desyncs the router and
 *   intermittently forces a hard navigation (full page reload). A plain route
 *   handler returns the payload as JSON with zero router churn, so the swap is
 *   always a clean in-place DOM update.
 *
 * Object-level access is re-checked on every call, identical to a fresh page
 * load, so URL-guessing a lesson the student can't see returns 403.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;

  let studentId: string;
  try {
    const { student } = await requireStudent();
    studentId = student.id;
    await requireVideoAccess(studentId, videoId);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "no-access" }, { status: 403 });
    }
    throw e;
  }

  const data = await getWatchData(studentId, videoId);
  if (!data) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  return NextResponse.json(data, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

# LMS V1 — Project Notes

A logic-first Learning Management System. **This is V1.** The mission is correctness, security, and architecture — not UI polish. Read `idea.md` for the full spec.

## Golden rules

1. **No styling work.** Plain HTML elements only — `<form>`, `<input>`, `<table>`, `<button>`, `<a>`. No Tailwind, no CSS frameworks, no animations, no icons. Browser default styling is the goal.
2. **Authorization is server-side, every time.** Never trust the client. Every server action and route handler that touches data calls a helper from `lib/authorization.ts` first.
3. **Object-level access.** A student visiting `/courses/5` must pass `canAccessCourse(studentId, 5)`. URL-guessing must return 403/404, not data.
4. **Don't duplicate courses.** One `Course` row per real course (e.g., one "Excel"). Access is granted through exactly **one** path: a student is in one or more batches (`StudentBatch`), and each batch has courses (`BatchCourse`). `getAccessibleCourses` returns the union, deduplicated. (Packages, direct per-student enrollment, and per-student denials were removed — see "Access model".)
5. **Batch is the only access path.** Courses are assigned to a *batch* progressively as classes happen — never to a student directly, and never as an all-at-once "package" (which would leak future videos early). Add a student to a batch to grant access; remove them to revoke.
6. **Audit important mutations.** Every admin write that matters (CRUD on students/batches/courses/modules/videos/notes, batch-course + student-batch assignment, plus auth denials) calls `createAuditLog`. Key actions: `STUDENT_BATCH_ASSIGNED/REMOVED`, `BATCH_COURSE_ASSIGNED/REMOVED`, `BULK_*` in `lib/audit-log.ts`.
7. **Video security is honest.** Browser-playable video can always be screen-captured. Goal is access control + no overt download button — not DRM. Architecture stays pluggable so we can swap Drive for Vimeo/Mux/signed URLs later.
8. **Drive ID is canonical.** Admins paste any Drive URL shape; `lib/drive.ts > parseDriveFileId` extracts the bare ID and that's all the DB stores. Render code derives embed/download URLs via `buildDriveEmbedUrl` / `buildDriveDownloadUrl`. Never store full URLs.
9. **Video duration is auto-fetched.** `lib/drive.ts > fetchDriveVideoMetadata` calls the Drive API (`GOOGLE_DRIVE_API_KEY`) and patches `Video.duration`. Files must be shared "anyone with link". Fire-and-forget; never blocks save.

## Stack

- Next.js 15 (App Router) + TypeScript
- Prisma + PostgreSQL (production runs on Postgres; `DATABASE_URL`)
- NextAuth v5 (Auth.js) with Google OAuth — Prisma adapter
- Zod for input validation
- Server Actions for mutations
- No UI library

## Layout

```
/app          — App Router pages (admin/, login/, dashboard/, courses/, videos/)
/lib          — auth, db, authorization, validations, course-access, video-provider, audit-log, drive (URL parser + Drive API)
/actions      — Server Actions, one file per entity (notes use FormData for uploads; bulk has CSV upload + bulkAction)
/components   — BasicForm, BasicTable (only what's actually shared)
/prisma       — schema.prisma + seed.ts
```

Business logic stays in `lib/`. Server Actions in `actions/` are thin: validate (Zod) → authorize (lib/authorization) → mutate (lib/db) → audit (lib/audit-log) → revalidate.

## Access model (the core invariant)

Batch-centric. A student can access a course if **all** of the following hold:

- Some batch the student belongs to (`StudentBatch`) has that course assigned
  (`BatchCourse`). A student may be in **multiple** batches; access is the union.
- AND student is `active`, `accessStartDate <= now <= accessEndDate`, course is `active`.
  Module/video access inherits from course access (and the entity's own `active` status).

`canAccessCourse` resolves this in one query:
`batchCourse.findFirst({ where: { courseId, batch: { studentBatches: { some: { studentId } } } } })`.
`getStudentsWithCourseAccess(courseId)` is the inverse (batches with the course →
their students). There are **no** packages, direct per-student enrollments, or
per-student denials anymore — those models were dropped.

## Auth flow

Google OAuth → callback receives email → resolve as `Admin` (active) **or** `Student` (active, not expired). If neither, deny and write `LOGIN_DENIED_UNREGISTERED_EMAIL` audit log. Session carries `{ role: "admin" | "student", id }`.

## Don't do

- Don't add UI libraries, icons, charts, theme systems, or layout polish.
- Don't put authorization checks in client components — server only.
- Don't expose `driveFileId` to students who can't access the video.
- Don't offer a download button for videos. Notes can be downloadable only if `note.downloadEnabled`.
- Don't mass-assign Prisma `data: req.body` — pick fields explicitly.
- Don't `cascade` delete on things with audit history; prefer status flags.

## Admin workflow

1. Create courses (and their modules/videos).
2. Create a **batch** (a cohort/class) and assign it courses — add more courses
   later as classes progress.
3. Add students to the batch. Two bulk tools on `/admin/bulk`: (a) "add students
   to a batch" (paste `name,email[,studentCode]`), and (b) "full bootstrap"
   (`studentCode,name,email,batchCode,courseNames`, auto-creating batches +
   assigning courses). Search page does bulk add/remove-from-batch on existing students.

## Setup

```bash
cp .env.example .env   # fill DATABASE_URL, AUTH_GOOGLE_ID/SECRET, AUTH_SECRET
npm install
npm run db:push        # syncs the Postgres schema
npm run db:seed        # seeds admin + sample batches/courses/students
npm run dev
```

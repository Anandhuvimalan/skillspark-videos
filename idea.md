Act as a senior full-stack architect, system design expert, and security-focused engineer.

Build a logic-first LMS platform using modern, secure, scalable architecture.

This is Version 1.

> **⚠️ SUPERSEDED — access model changed (V1.1, batch-centric).**
> The original spec below grants course access through four paths (direct course,
> direct package, batch course, batch package) plus per-student denials. That has
> been **replaced** by a single batch-centric model and is the source of truth in
> `CLAUDE.md`:
> - Access = a student is in one or more **batches** (`StudentBatch`, many-to-many);
>   each batch has courses (`BatchCourse`); access is the **union** of those courses.
> - **Removed entirely:** packages (`Package`/`PackageCourse`/`StudentPackage`/
>   `BatchPackage`), direct per-student enrollment (`StudentCourse`), and per-student
>   denials (`StudentCourseDenial`). Courses are assigned to a batch progressively so
>   students never get future videos early.
> - Production runs on **PostgreSQL** (not SQLite).
> Treat the package / direct-enrollment / denial sections below as historical.

VERY IMPORTANT:
Do NOT focus on design, styling, animations, colors, layout polish, responsive perfection, dashboard beauty, landing page, marketing page, icons, charts, or UI components.

Use only basic HTML-like UI:
- Plain forms
- Plain input fields
- Plain select boxes
- Plain textareas
- Plain tables
- Plain buttons
- Plain links
- Simple headings
- Simple lists
- Browser default styling is acceptable

Do NOT spend time or context on:
- CSS polish
- Tailwind styling
- Animations
- Framer Motion
- ShadCN UI
- Complex layouts
- Sidebar design
- Theme system
- Mobile-perfect design
- Dashboard design

Design will be done later after all logic is working, tested, and approved.

The first milestone is:
- Correct system architecture
- Secure authentication
- Strong authorization
- Clean database design
- Complete CRUD operations
- Flexible course/package/batch enrollment logic
- Efficient video progress tracking
- Admin control
- Student access control
- Audit logging
- Maintainable code structure
- Working basic pages

Core Architecture Principle:
Make it work first.
Make it correct.
Make it secure.
Make it efficient.
Make it beautiful later.

==================================================
TECH STACK
==================================================

Use:
- Next.js latest stable version
- TypeScript
- App Router
- SQLite for development database
- Prisma ORM
- Auth.js / NextAuth with Google OAuth
- Zod validation
- Server Actions and/or API routes
- Secure server-side authorization checks
- Google Drive file IDs / embed URLs for video delivery
- Modular video provider structure so the video system can later be replaced with:
  - Vimeo
  - Mux
  - AWS S3 + CloudFront
  - Signed URLs
  - HLS player
  - DRM-capable provider

Do not use heavy UI libraries now.

==================================================
IMPORTANT VIDEO SECURITY TRUTH
==================================================

Do not claim that browser-playable video can be protected 100%.

If a video can be played inside a browser, a technical user may still inspect, capture, screen-record, or find ways to extract it.

Version 1 goal:
- Strong platform access control
- Only approved students can view assigned videos
- No visible download button for videos
- Do not directly expose video links in normal UI where avoidable
- Restrict access through backend authorization
- Keep architecture ready for future upgrade to signed URLs, tokenized playback, Vimeo, Mux, AWS S3/CloudFront, or DRM provider

Notes/PDFs can be downloadable if admin enables download.

==================================================
1. AUTHENTICATION AND AUTHORIZATION
==================================================

Use Google OAuth login.

There are two user types:
1. Admin
2. Student

Rules:
- Only registered admin emails can access admin routes.
- Only students added by admin can access student routes.
- If a Google account email is not registered, show Access Denied.
- Blocked students cannot access the platform.
- Expired students cannot access course/video/note content.
- Every protected server action/API must verify authorization server-side.
- Never trust frontend checks alone.
- Never rely on hidden frontend buttons for security.

Required checks:
- Is user logged in?
- Is user an admin for admin actions?
- Is student registered?
- Is student active?
- Is student access expired?
- Does student have access to the requested course?
- Does student have access to the requested module?
- Does student have access to the requested video?
- Does student have access to the requested note?

Create centralized authorization helper functions.

Example helpers:
- getCurrentSessionUser()
- requireAdmin()
- requireStudent()
- getCurrentStudent()
- isStudentActive(studentId)
- isStudentExpired(studentId)
- canAccessCourse(studentId, courseId)
- canAccessModule(studentId, moduleId)
- canAccessVideo(studentId, videoId)
- canAccessNote(studentId, noteId)

All admin actions must call requireAdmin().
All student content actions must call requireStudent() and object-level access checks.

==================================================
2. DATABASE DESIGN
==================================================

Use Prisma with SQLite.

Create a normalized database structure.

Main entities:
- Admin
- Student
- Batch
- Package
- Course
- PackageCourse
- StudentPackage
- StudentCourse
- BatchPackage
- BatchCourse
- Module
- Video
- Note
- VideoProgress
- AuditLog

Important design concept:
Do NOT duplicate courses.

Wrong:
- ADFFA Excel
- Data Analytics Excel
- Single Excel

Correct:
- One Excel course
- Excel can belong to many packages
- Excel can also be assigned directly to students
- Excel can also be assigned to a batch

==================================================
3. ADMIN MODEL
==================================================

Admin fields:
- id
- name
- email
- status
- createdAt
- updatedAt

Rules:
- Admin email must be unique.
- Only active admins can access admin panel.
- Admin users are managed in database or seed initially.

==================================================
4. STUDENT MODEL
==================================================

Student fields:
- id
- studentCode
- name
- email
- batchId nullable
- status active/blocked
- accessStartDate
- accessEndDate
- createdAt
- updatedAt

Rules:
- Email must be unique.
- studentCode must be unique.
- Student can belong to one batch initially.
- Student can have direct course enrollments.
- Student can have package enrollments.
- Student can also inherit access through batch enrollments.
- If accessEndDate is passed, student cannot access courses/videos/notes.

==================================================
5. BATCH MODEL
==================================================

Batch fields:
- id
- batchCode
- batchName
- description
- createdAt
- updatedAt

Admin can:
- Create batch
- Edit batch
- Delete batch
- View students inside batch
- Assign package to full batch
- Assign course to full batch

Batch use case:
A full batch, like ONLB 101, can be assigned Data Analytics package.
Then every active student in that batch should inherit access to all courses inside Data Analytics.

==================================================
6. PACKAGE AND COURSE LOGIC
==================================================

The system must support:

1. Full package enrollment
Example:
ADFFA Package contains:
- GST
- VAT
- Accounting
- Excel

2. Single course enrollment
Example:
Student takes Excel only.

3. Multiple selected courses
Example:
Student takes Python + SQL only.

4. Shared courses across packages
Example:
Excel can be inside ADFFA and Data Analytics.

5. Batch-level package/course access
Example:
Batch ONLB 101 gets Data Analytics.
All students in that batch get access to Excel, SQL, Python, Power BI Desktop, and Power BI Service.

Package fields:
- id
- name
- description
- status active/inactive
- createdAt
- updatedAt

Course fields:
- id
- name
- description
- status active/inactive
- createdAt
- updatedAt

PackageCourse table:
- id
- packageId
- courseId
- createdAt

Rules:
- A course can belong to many packages.
- A package can contain many courses.
- Avoid duplicate mappings using unique constraints.

==================================================
7. ENROLLMENT LOGIC
==================================================

Admin can assign access in multiple ways:

Direct student access:
- Student to package
- Student to course

Batch access:
- Batch to package
- Batch to course

Bulk access:
- Selected student IDs to course
- Selected student IDs to package
- Selected emails to course
- Selected emails to package

Enrollment tables:

student_packages:
- id
- studentId
- packageId
- assignedAt

student_courses:
- id
- studentId
- courseId
- assignedAt

batch_packages:
- id
- batchId
- packageId
- assignedAt

batch_courses:
- id
- batchId
- courseId
- assignedAt

Important:
Student dashboard must show accessible courses from:
1. Direct student course enrollment
2. Courses inside directly assigned student packages
3. Batch course enrollment
4. Courses inside batch package enrollment

Remove duplicate courses before displaying.

Example:
If a student has Excel directly and also through ADFFA package, show Excel only once.

==================================================
8. INTELLIGENT COURSE ACCESS FUNCTIONS
==================================================

Create reusable business logic functions.

Function:
getAccessibleCourses(studentId)

It should return all unique active courses available to the student from:
1. Direct course assignment
2. Direct package assignment
3. Batch course assignment
4. Batch package assignment

Function:
canAccessCourse(studentId, courseId)

It should return true if course is available through any valid access path.

Function:
getStudentsWithCourseAccess(courseId)

This is important for admin filtering.

If admin searches “Excel students”, result must include:
- Students directly assigned Excel
- Students assigned packages containing Excel
- Students in batches assigned Excel
- Students in batches assigned packages containing Excel

Function:
getStudentAccessSources(studentId, courseId)

This should optionally explain why a student has access:
- Direct course
- Direct package
- Batch course
- Batch package

This is useful for admin debugging.

==================================================
9. ADMIN CRUD REQUIREMENTS
==================================================

Admin panel must have full CRUD for all main entities.

Students:
- Create
- Read
- Update
- Delete
- Block/activate
- Set access start date
- Set access end date
- Assign batch
- View assigned courses/packages
- View inherited access

Batches:
- Create
- Read
- Update
- Delete
- View students in batch
- View batch course/package assignments

Packages:
- Create
- Read
- Update
- Delete
- Activate/inactivate
- Add/remove courses inside package

Courses:
- Create
- Read
- Update
- Delete
- Activate/inactivate

Modules:
- Create
- Read
- Update
- Delete
- Reorder

Videos:
- Create
- Read
- Update
- Delete
- Reorder
- Activate/inactivate

Notes:
- Create
- Read
- Update
- Delete
- Enable/disable download

Enrollments:
- Assign course to student
- Assign package to student
- Assign course to batch
- Assign package to batch
- Remove course from student
- Remove package from student
- Remove course from batch
- Remove package from batch
- Bulk assign using pasted student codes/emails

All CRUD pages can use plain tables and forms.

==================================================
10. MODULE STRUCTURE
==================================================

Each course can have modules or sections.

Module fields:
- id
- courseId
- title
- description
- moduleOrder
- createdAt
- updatedAt

Rules:
- Modules must be ordered by moduleOrder.
- Admin can reorder modules.
- Student sees modules only for accessible courses.
- Inactive/deleted courses should not expose modules to students.

==================================================
11. VIDEO STRUCTURE
==================================================

Each module can have videos.

Video fields:
- id
- moduleId
- title
- description
- driveFileId
- driveEmbedUrl
- videoOrder
- duration
- status active/inactive
- createdAt
- updatedAt

Rules:
- Videos must be ordered by videoOrder.
- Admin can add Drive file ID and/or embed URL.
- Student can only access active videos from courses they are allowed to access.
- If video is inactive, student cannot access it.
- Video belongs to module.
- Module belongs to course.
- Course access decides video access.

==================================================
12. NOTES STRUCTURE
==================================================

Each video can have notes.

Note fields:
- id
- videoId
- title
- fileUrl
- downloadEnabled
- createdAt
- updatedAt

Rules:
- Notes are visible only if student can access the video.
- Download is allowed only if downloadEnabled is true.
- Notes/PDF download is allowed based on admin setting.
- Video download should not be offered.

==================================================
13. STUDENT FLOW
==================================================

Student login flow:

Student clicks login
→ Google OAuth
→ Get email
→ Check student table
→ Check student status active
→ Check accessStartDate/accessEndDate
→ Allow dashboard or deny access

Student dashboard:
- Show only accessible active courses
- Very basic list/table only
- No design polish

Course page:
- Verify course access server-side
- Show modules in order
- Show videos in order
- Show notes under videos
- Very basic layout

Video page:
- Verify video access server-side
- Show Google Drive embedded video
- Show notes
- Track progress
- Resume from last watched timestamp if technically possible

==================================================
14. VIDEO PROGRESS / RESUME LOGIC
==================================================

Create video_progress table:

- id
- studentId
- videoId
- lastTimestamp
- completed
- updatedAt

Rules:
- Save progress every 10 to 15 seconds, not every second.
- Save on pause.
- Save when user leaves the page.
- Save when video ends.
- Only update if timestamp changed meaningfully.
- Avoid unnecessary API/database calls.
- Progress must be student-specific and video-specific.

Important:
Google Drive iframe may not allow full JavaScript control of currentTime.
Still create the database/API structure cleanly.
Implement the best possible tracking.
Keep the video player abstraction modular so later we can replace Google Drive with:
- Vimeo
- Mux
- AWS S3 + CloudFront
- signed URLs
- custom HLS player

Create a provider-based structure if possible:
- VideoProvider interface
- GoogleDriveVideoProvider implementation

Even if resume cannot be perfectly controlled with Google Drive iframe, the architecture must be ready for a future provider that supports proper currentTime control.

==================================================
15. ADMIN SEARCH AND FILTER
==================================================

Admin must be able to search/filter students by:

- Name
- Student code
- Gmail
- Batch
- Package
- Course
- Active/blocked
- Expired/not expired

Course access filter must include inherited access.

Example:
Search Excel students should include:
- Students directly assigned Excel
- Students assigned ADFFA package if ADFFA contains Excel
- Students assigned Data Analytics package if Data Analytics contains Excel
- Students from batches assigned Excel
- Students from batches assigned packages that contain Excel

Admin should also be able to view:
- How the student got access to a course
- Direct course
- Direct package
- Batch course
- Batch package

==================================================
16. BULK OPERATIONS
==================================================

Use simple textarea inputs for now.

Bulk add students:
- Paste rows or CSV-like text
- studentCode, name, email, batchCode

Bulk assign:
- Paste student codes or emails
- Select course/package
- Assign to all valid students

Validation:
- Skip invalid emails
- Show success count
- Show failed rows
- Avoid duplicate enrollments
- Use unique constraints
- Do not crash on invalid rows

Bulk operations can be basic and functional.

==================================================
17. SECURITY REQUIREMENTS
==================================================

Use professional security practices:

Input validation:
- Validate all input using Zod.
- Validate IDs.
- Validate dates.
- Validate email format.
- Validate Google Drive file IDs/URLs.
- Validate note file URLs.

Authorization:
- Use server-side authorization for every mutation.
- Use object-level authorization.
- Protect all admin routes.
- Protect all student routes.
- Never expose admin-only data to students.
- Never trust frontend-only checks.

Session/security:
- Use Auth.js/NextAuth secure session handling.
- Use environment variables for secrets.
- Do not hardcode secrets.
- Do not store OAuth client secrets in code.

Data protection:
- Avoid leaking sensitive database errors to users.
- Use defensive error handling.
- Log server errors safely.
- Use least privilege logic.
- Keep access checks close to data access.
- Avoid over-fetching sensitive fields.

Database:
- Use unique constraints to avoid duplicate enrollments.
- Use relational integrity.
- Use cascading carefully.
- Prefer soft status inactive where deletion may break history.
- Keep timestamps.

Object-level authorization examples:
A student should not access:
/courses/5
unless canAccessCourse(studentId, 5) returns true.

A student should not access:
/videos/10
unless canAccessVideo(studentId, 10) returns true.

A student should not access a note unless canAccessNote(studentId, noteId) returns true.

==================================================
18. AUDIT LOGS
==================================================

Add audit logging for important admin and system actions.

Goal:
Track who changed what, when, and from where if possible.

This is important for:
- Security
- Debugging
- Admin accountability
- Course access history
- Student support issues

Create an AuditLog model.

AuditLog fields:
- id
- actorId nullable
- actorEmail
- actorType admin/student/system
- action
- entityType
- entityId nullable
- oldValue nullable
- newValue nullable
- ipAddress nullable
- userAgent nullable
- createdAt

Examples of actions to log:

Student management:
- STUDENT_CREATED
- STUDENT_UPDATED
- STUDENT_DELETED
- STUDENT_BLOCKED
- STUDENT_ACTIVATED
- STUDENT_ACCESS_DATES_CHANGED
- STUDENT_BATCH_CHANGED

Batch management:
- BATCH_CREATED
- BATCH_UPDATED
- BATCH_DELETED

Course/package management:
- COURSE_CREATED
- COURSE_UPDATED
- COURSE_DELETED
- COURSE_ACTIVATED
- COURSE_INACTIVATED
- PACKAGE_CREATED
- PACKAGE_UPDATED
- PACKAGE_DELETED
- PACKAGE_COURSE_ADDED
- PACKAGE_COURSE_REMOVED

Enrollment management:
- STUDENT_COURSE_ASSIGNED
- STUDENT_COURSE_REMOVED
- STUDENT_PACKAGE_ASSIGNED
- STUDENT_PACKAGE_REMOVED
- BATCH_COURSE_ASSIGNED
- BATCH_COURSE_REMOVED
- BATCH_PACKAGE_ASSIGNED
- BATCH_PACKAGE_REMOVED
- BULK_ENROLLMENT_CREATED

Content management:
- MODULE_CREATED
- MODULE_UPDATED
- MODULE_DELETED
- MODULE_REORDERED
- VIDEO_CREATED
- VIDEO_UPDATED
- VIDEO_DELETED
- VIDEO_REORDERED
- VIDEO_ACTIVATED
- VIDEO_INACTIVATED
- NOTE_CREATED
- NOTE_UPDATED
- NOTE_DELETED
- NOTE_DOWNLOAD_ENABLED
- NOTE_DOWNLOAD_DISABLED

Authentication/security:
- ADMIN_LOGIN
- STUDENT_LOGIN
- LOGIN_DENIED_UNREGISTERED_EMAIL
- LOGIN_DENIED_BLOCKED_STUDENT
- LOGIN_DENIED_EXPIRED_STUDENT
- UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT
- UNAUTHORIZED_COURSE_ACCESS_ATTEMPT
- UNAUTHORIZED_VIDEO_ACCESS_ATTEMPT

Rules:
- Every important admin mutation must create an audit log.
- Failed access attempts should be logged.
- Do not store passwords or secrets in audit logs.
- Do not store OAuth tokens in audit logs.
- oldValue and newValue can be stored as JSON strings.
- Keep audit logging server-side only.
- Students should not see audit logs.
- Only admins can view audit logs.

Admin audit log page:
Create a basic page:

/admin/audit-logs

Features:
- View audit logs in a plain table
- Filter by actorEmail
- Filter by action
- Filter by entityType
- Filter by date range
- No design focus, only basic working table and filters

Add reusable helper:

createAuditLog({
  actorId,
  actorEmail,
  actorType,
  action,
  entityType,
  entityId,
  oldValue,
  newValue,
  ipAddress,
  userAgent
})

Use this helper inside admin actions and security-sensitive operations.

Testing:
- Creating a student creates audit log
- Updating a student creates audit log
- Assigning a course creates audit log
- Removing course access creates audit log
- Blocking a student creates audit log
- Unauthorized access attempt creates audit log
- Admin can view audit logs
- Student cannot view audit logs

==================================================
19. ROUTES
==================================================

Student routes:
- /login
- /dashboard
- /courses/[courseId]
- /videos/[videoId]

Admin routes:
- /admin
- /admin/students
- /admin/batches
- /admin/packages
- /admin/courses
- /admin/modules
- /admin/videos
- /admin/notes
- /admin/enrollments
- /admin/search
- /admin/bulk
- /admin/audit-logs

Keep pages basic and functional.

==================================================
20. PROJECT STRUCTURE
==================================================

Use clean architecture-style organization.

Suggested structure:

/app
  /login
  /dashboard
  /courses
  /videos
  /admin

/lib
  auth.ts
  db.ts
  authorization.ts
  validations.ts
  course-access.ts
  video-access.ts
  bulk.ts
  video-provider.ts
  audit-log.ts

/actions
  students.ts
  batches.ts
  courses.ts
  packages.ts
  enrollments.ts
  modules.ts
  videos.ts
  notes.ts
  progress.ts
  bulk.ts
  audit-logs.ts

/components
  BasicForm.tsx
  BasicTable.tsx

/prisma
  schema.prisma
  seed.ts

Keep business logic outside UI where possible.

UI components should be basic only.

==================================================
21. SEED DATA
==================================================

Create seed data.

Admin:
- admin@example.com

Batches:
- ONLB 101
- ONLB 102

Packages:
- ADFFA
- Data Analytics

Courses:
- Excel
- GST
- VAT
- Accounting
- SQL
- Python
- Power BI Desktop
- Power BI Service

Mappings:

ADFFA:
- GST
- VAT
- Accounting
- Excel

Data Analytics:
- Excel
- SQL
- Python
- Power BI Desktop
- Power BI Service

Students:
- One student assigned ADFFA package
- One student assigned Excel only
- One student assigned Python + SQL
- One batch assigned Data Analytics

Videos:
- Add sample Drive file IDs
- Add sample modules
- Add sample notes

Audit logs:
- Add few sample audit log records if useful

==================================================
22. DEVELOPMENT ORDER
==================================================

Build in this exact order:

1. Initialize Next.js + TypeScript project
2. Add Prisma + SQLite
3. Design Prisma schema
4. Add seed data
5. Setup Auth.js / NextAuth Google OAuth
6. Implement admin/student role resolution
7. Implement authorization helpers
8. Build admin CRUD for batches
9. Build admin CRUD for students
10. Build admin CRUD for courses
11. Build admin CRUD for packages
12. Build package-course mapping
13. Build enrollment logic
14. Build getAccessibleCourses(studentId)
15. Build getStudentsWithCourseAccess(courseId)
16. Build student dashboard
17. Build course page with modules/videos
18. Build module CRUD
19. Build video CRUD
20. Build notes CRUD
21. Build video page
22. Build progress tracking
23. Build admin search/filter
24. Build bulk operations
25. Add validation and security hardening
26. Add AuditLog model
27. Add audit log helper
28. Add audit logs to important admin actions
29. Add audit logs to security-sensitive events
30. Add audit log admin page
31. Test every access-control and audit-log edge case

==================================================
23. TESTING CHECKLIST
==================================================

Test these cases.

Authentication:
- Unregistered Gmail cannot access
- Registered student can access
- Blocked student cannot access
- Expired student cannot access
- Admin can access admin panel
- Student cannot access admin panel

Course access:
- Student sees direct courses
- Student sees package courses
- Student sees batch courses
- Student sees batch package courses
- Duplicate courses do not appear twice
- Student cannot access another course by URL
- Inactive course does not show to student

Video access:
- Student can view assigned course video
- Student cannot view unassigned video by URL
- Inactive video is not accessible
- Notes only visible for accessible videos

Admin:
- CRUD works for all entities
- Reordering modules works
- Reordering videos works
- Bulk student upload works
- Bulk enrollment works
- Search by course includes inherited package/batch access
- Duplicate enrollments are avoided

Progress:
- Timestamp saves
- Timestamp does not save every second
- Resume logic works as much as Google Drive allows
- Progress is student-specific and video-specific

Security:
- Admin APIs reject students
- Student APIs reject unregistered users
- Object-level authorization works
- Invalid IDs do not expose data
- Expired students cannot access videos by direct URL

Audit logs:
- Student creation is logged
- Student update is logged
- Student block/activate is logged
- Course/package assignment is logged
- Course/package removal is logged
- Video creation/update/delete is logged
- Module/video reorder is logged
- Unauthorized access attempt is logged
- Login denied events are logged
- Admin can view audit logs
- Student cannot view audit logs

==================================================
24. WHAT NOT TO BUILD NOW
==================================================

Do NOT build:

- Beautiful UI
- Animation
- Landing page
- Marketing page
- Complex dashboards
- Charts
- Advanced sidebar
- Mobile-perfect design
- Theme system
- Heavy component library
- Branding polish
- Color system
- Icons
- Tailwind-heavy styling
- Framer Motion
- ShadCN UI

Only build:
- Working logic
- CRUD
- Authentication
- Authorization
- Enrollment
- Video access
- Progress tracking
- Audit logging
- Basic pages

Plain HTML-style pages are enough.

==================================================
25. EXPECTED FINAL OUTPUT
==================================================

Deliver a working Next.js LMS project with:

- SQLite + Prisma database
- Google OAuth login
- Admin/student access control
- Complete CRUD for all entities
- Package/course/sub-course logic
- Batch and student enrollment logic
- Student dashboard
- Course/video/notes access
- Google Drive video embed support
- Video progress/resume architecture
- Admin filters and bulk operations
- Audit logs for admin actions and security-sensitive events
- Basic functional UI only

Final reminder:
This is Version 1.
The goal is not beauty.
The goal is correctness, security, flexibility, auditability, and working system logic.

Use minimum styling. Browser default design is acceptable.

After this works perfectly, design and UI polish will be handled separately.
"""
Import students from the Google Drive "videos" folder into the batch-centric LMS.

Drive model: under the shared `videos` folder, each subfolder is a course, and
every person with VIEW (reader) access to that folder is a student of it. Staff
hold writer/owner roles (excluded globally).

Batch-model mapping (these old students have no batch code, so we synthesise one
per course): for each course folder we ensure a batch named after the course
(one course assigned to it) and add that folder's viewers to that batch. A
student who views N folders ends up in N single-course batches — their access is
exactly the union of the courses they were a viewer of.

Safety: dry-run by default; pass --commit to write. Idempotent (existing
students, batches, course-assignments and memberships are skipped via ON
CONFLICT), so committing twice is safe.

  python scripts/import_students_from_drive.py                       # dry run
  python scripts/import_students_from_drive.py --commit
  python scripts/import_students_from_drive.py --commit --start 2026-06-29 --end 2026-12-29

Deps:  pip install requests pyjwt cryptography psycopg2-binary
"""

import argparse
import datetime as dt
import json
import re
import secrets
import string
import sys
import time

import jwt
import requests
import psycopg2
import psycopg2.extras

FOLDER_MIME = "application/vnd.google-apps.folder"

# Folder names that don't equal their DB course name 1:1 -> map to the canonical
# existing course (no duplicate courses). Keys are normalized folder names.
COURSE_ALIASES = {
    "sap mm": "SAP MM / SAP Sourcing and Procurement",
    "sap s/4hana fico": "SAP S/4HANA (FICO)",
    "data visualization and reporting using power bi": "Power BI",
}

STAFF_ROLES = {"writer", "owner", "organizer", "fileOrganizer"}
STUDENT_ROLES = {"reader", "commenter"}

ID_ALPHABET = string.ascii_lowercase + string.digits


# ---------- helpers ----------

def load_env(path=".env"):
    txt = open(path, encoding="utf-8").read()
    env = {}
    for m in re.finditer(r"^([A-Z0-9_]+)=(?:'([\s\S]*?)'|\"([^\"]*)\"|(.*))$", txt, re.M):
        env[m.group(1)] = m.group(2) or m.group(3) or m.group(4) or ""
    return env


def cuid():
    """cuid-like unique id (the schema only needs a unique String PK)."""
    return "c" + "".join(secrets.choice(ID_ALPHABET) for _ in range(24))


def norm(s):
    return re.sub(r"\s+", " ", s.strip().lower())


def slug(s):
    out = re.sub(r"[^A-Za-z0-9 _-]+", "-", s.strip())
    out = re.sub(r"-{2,}", "-", out).strip("- ")
    return out[:60] or "batch"


def derive_name(email, display_name):
    dn = (display_name or "").strip()
    local = email.split("@")[0]
    if dn and dn.lower() != local.lower():
        return dn
    parts = [p for p in re.split(r"[._-]+", local) if p]
    return " ".join(w[:1].upper() + w[1:] for w in parts) or email


# ---------- Drive ----------

def get_token(sa):
    now = int(time.time())
    payload = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/drive.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }
    assertion = jwt.encode(payload, sa["private_key"], algorithm="RS256")
    r = requests.post(
        "https://oauth2.googleapis.com/token",
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def drive_list(token, q):
    out, page = [], None
    while True:
        params = {
            "q": q,
            "fields": "nextPageToken,files(id,name)",
            "pageSize": "1000",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
            "corpora": "allDrives",
        }
        if page:
            params["pageToken"] = page
        r = requests.get(
            "https://www.googleapis.com/drive/v3/files",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
        )
        r.raise_for_status()
        j = r.json()
        out.extend(j.get("files", []))
        page = j.get("nextPageToken")
        if not page:
            return out


def list_user_permissions(token, file_id):
    out, page = [], None
    while True:
        params = {
            "fields": "nextPageToken,permissions(type,role,emailAddress,displayName)",
            "pageSize": "100",
            "supportsAllDrives": "true",
        }
        if page:
            params["pageToken"] = page
        r = requests.get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}/permissions",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
        )
        r.raise_for_status()
        j = r.json()
        out.extend(j.get("permissions", []))
        page = j.get("nextPageToken")
        if not page:
            return [p for p in out if p.get("type") == "user" and p.get("emailAddress")]


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--code-prefix", default="SS")
    args = ap.parse_args()

    env = load_env()
    sa = json.loads(env["GOOGLE_SERVICE_ACCOUNT_JSON"])

    today = dt.date.today()
    start = dt.date.fromisoformat(args.start) if args.start else today
    end = dt.date.fromisoformat(args.end) if args.end else (today + dt.timedelta(days=180))
    if end < start:
        sys.exit("--end is before --start")

    mode = "COMMIT" if args.commit else "DRY RUN — no writes"
    print(f"\n=== Drive -> LMS student import ({mode}) ===")
    print(f"Access window for NEW students: {start} -> {end}")

    token = get_token(sa)
    print(f"  SA: {sa['client_email']}")

    videos = drive_list(token, f"name = 'videos' and mimeType = '{FOLDER_MIME}' and trashed = false")
    if not videos:
        sys.exit('No "videos" folder visible to the service account.')
    vf = videos[0]
    print(f'\nvideos folder: "{vf["name"]}" ({vf["id"]})')

    folders = drive_list(token, f"'{vf['id']}' in parents and mimeType = '{FOLDER_MIME}' and trashed = false")
    print(f"Course folders: {len(folders)}")

    # Pass 1: collect perms; build global staff set (writer/owner anywhere).
    folder_perms, staff = {}, set()
    for f in folders:
        perms = list_user_permissions(token, f["id"])
        folder_perms[f["id"]] = perms
        for p in perms:
            if p["role"] in STAFF_ROLES:
                staff.add(p["emailAddress"].strip().lower())

    # Pass 2: readers -> students (excluding staff).
    by_email = {}          # email -> {name, folders:set(folder_name)}
    per_folder = []
    excluded_staff = set()
    for f in folders:
        readers = 0
        for p in folder_perms[f["id"]]:
            if p["role"] not in STUDENT_ROLES:
                continue
            email = p["emailAddress"].strip().lower()
            if email in staff:
                excluded_staff.add(email)
                continue
            readers += 1
            acc = by_email.setdefault(email, {"name": derive_name(email, p.get("displayName")), "folders": set()})
            acc["folders"].add(f["name"])
        per_folder.append((f["name"], readers))

    print("\nStudents (view-only, staff excluded) per course folder:")
    for name, n in per_folder:
        print(f"  {n:>3}  {name}")
    print(f"\nUnique student emails: {len(by_email)}")
    print(f"Staff excluded (writer/owner somewhere): {len(staff)}")

    # ---------- DB ----------
    conn = psycopg2.connect(env["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute('SELECT id, name FROM "Course"')
    course_by_norm = {}
    for row in cur.fetchall():
        course_by_norm[norm(row["name"])] = (row["id"], row["name"])

    # Resolve folder -> course (with aliases).
    folder_to_course = {}   # folder_name -> (course_id, course_name)
    unmatched = []
    for f in folders:
        c = course_by_norm.get(norm(f["name"]))
        if not c:
            alias = COURSE_ALIASES.get(norm(f["name"]))
            if alias:
                c = course_by_norm.get(norm(alias))
        if c:
            folder_to_course[f["name"]] = c
        else:
            unmatched.append(f["name"])

    print("\nFolder -> Course:")
    for f in folders:
        c = folder_to_course.get(f["name"])
        print(f'  {"OK " if c else "XX "} {f["name"]}{"" if c else "   (no DB course)"}')
    if unmatched:
        print(f"Unmatched folders (skipped): {', '.join(unmatched)}")

    # Each matched course -> one batch (batchCode = slug, batchName = course name).
    # Build the plan: which batches to ensure, which course each carries.
    batch_for_course = {}   # course_id -> {code, name}
    for f in folders:
        c = folder_to_course.get(f["name"])
        if not c:
            continue
        cid, cname = c
        batch_for_course[cid] = {"code": slug(cname), "name": cname}

    # Existing students / batches.
    cur.execute('SELECT email, id FROM "Student"')
    existing_students = {r["email"].lower(): r["id"] for r in cur.fetchall()}
    cur.execute('SELECT "studentCode" FROM "Student"')
    used_codes = {r["studentCode"] for r in cur.fetchall()}

    # Plan numbers.
    new_students = [e for e in by_email if e not in existing_students]
    students_no_course = [
        e for e, acc in by_email.items()
        if not any(f in folder_to_course for f in acc["folders"])
    ]
    total_memberships = sum(
        len({folder_to_course[f][0] for f in acc["folders"] if f in folder_to_course})
        for acc in by_email.values()
    )

    print("\n================= PLAN =================")
    print(f"Batches to ensure (one per matched course): {len(batch_for_course)}")
    print(f"New students to create:                     {len(new_students)}")
    print(f"Existing students (reused):                 {len(by_email) - len(new_students)}")
    print(f"Total batch memberships to ensure:          {total_memberships}")
    if students_no_course:
        print(f"Students with 0 matched courses (skipped):  {len(students_no_course)}")

    if not args.commit:
        print("\nDRY RUN complete. Nothing written. Re-run with --commit.\n")
        conn.rollback()
        cur.close(); conn.close()
        return

    # ---------- COMMIT ----------
    now = dt.datetime.now(dt.timezone.utc)
    start_dt = dt.datetime.combine(start, dt.time(), dt.timezone.utc)
    end_dt = dt.datetime.combine(end, dt.time(), dt.timezone.utc)

    # 1. Ensure batches + their course assignment; remember course_id -> batch_id.
    batch_id_for_course = {}
    for cid, b in batch_for_course.items():
        bid = cuid()
        cur.execute(
            'INSERT INTO "Batch" (id, "batchCode", "batchName", description, "createdAt", "updatedAt") '
            'VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT ("batchCode") DO NOTHING',
            (bid, b["code"], b["name"], "Drive import (per-course)", now, now),
        )
        cur.execute('SELECT id FROM "Batch" WHERE "batchCode" = %s', (b["code"],))
        bid = cur.fetchone()["id"]
        batch_id_for_course[cid] = bid
        cur.execute(
            'INSERT INTO "BatchCourse" (id, "batchId", "courseId", "assignedAt") '
            'VALUES (%s,%s,%s,%s) ON CONFLICT ("batchId","courseId") DO NOTHING',
            (cuid(), bid, cid, now),
        )

    # 2. studentCode allocator.
    counter = [1]
    def next_code():
        while True:
            code = f"{args.code_prefix}{counter[0]:04d}"
            counter[0] += 1
            if code not in used_codes:
                used_codes.add(code)
                return code

    created = 0
    memberships = 0
    for email, acc in by_email.items():
        course_ids = {folder_to_course[f][0] for f in acc["folders"] if f in folder_to_course}
        if not course_ids:
            continue  # skip students who map to no DB course
        sid = existing_students.get(email)
        if not sid:
            sid = cuid()
            cur.execute(
                'INSERT INTO "Student" (id, "studentCode", name, email, status, '
                '"accessStartDate", "accessEndDate", "createdAt", "updatedAt") '
                'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT ("email") DO NOTHING',
                (sid, next_code(), acc["name"], email, "active", start_dt, end_dt, now, now),
            )
            cur.execute('SELECT id FROM "Student" WHERE email = %s', (email,))
            sid = cur.fetchone()["id"]
            existing_students[email] = sid
            created += 1
        for cid in course_ids:
            bid = batch_id_for_course[cid]
            cur.execute(
                'INSERT INTO "StudentBatch" (id, "studentId", "batchId", "assignedAt") '
                'VALUES (%s,%s,%s,%s) ON CONFLICT ("studentId","batchId") DO NOTHING',
                (cuid(), sid, bid, now),
            )
            memberships += cur.rowcount

    # 3. Summary audit log.
    cur.execute(
        'INSERT INTO "AuditLog" (id, "actorType", "actorEmail", action, "entityType", "newValue", "createdAt") '
        'VALUES (%s,%s,%s,%s,%s,%s,%s)',
        (
            cuid(), "system", env.get("SEED_ADMIN_EMAIL"),
            "BULK_STUDENTS_CREATED", "Student",
            json.dumps({"created": created, "memberships": memberships,
                        "batches": len(batch_for_course), "source": "drive-import-python",
                        "accessStart": str(start), "accessEnd": str(end)}),
            now,
        ),
    )

    conn.commit()
    print("\n================ COMMITTED ================")
    print(f"Batches ensured:        {len(batch_for_course)}")
    print(f"Students created:       {created}")
    print(f"Memberships added:      {memberships}")
    print("Done.\n")
    cur.close(); conn.close()


if __name__ == "__main__":
    main()

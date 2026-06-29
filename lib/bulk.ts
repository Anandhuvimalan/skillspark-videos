/**
 * Parses pasted bulk input. V1 uses textareas — comma- or tab-separated rows.
 * Lines starting with '#' or empty lines are skipped.
 */

export type ParseResult<T> = {
  rows: T[];
  errors: { line: number; raw: string; reason: string }[];
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE_RE = /^[A-Za-z0-9 _-]+$/;
// Admin-given id + name packed in one cell, e.g. "KLM 2606 1282 Seethal U":
// <letters> <digits> <digits> then the name. Group 1 = id, group 2 = name.
const CODE_NAME_RE = /^([A-Za-z]{2,6}\s+\d{2,8}\s+\d{1,8})\s+(.+)$/;

function splitRow(line: string): string[] {
  // tab-separated wins, otherwise comma.
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  return line.split(",").map((s) => s.trim());
}

function splitPlusList(s: string | undefined): string[] {
  if (!s) return [];
  return s.split("+").map((x) => x.trim()).filter(Boolean);
}

// ---------- Full bootstrap student rows ----------

export type BulkStudentRow = {
  studentCode: string;
  name: string;
  email: string;
  batchCode?: string;
  /** Course names parsed from the courseNames column, split on `+`. */
  courseNames: string[];
};

/**
 * Full-bootstrap format:
 *   studentCode,name,email[,batchCode[,courseNames]]
 * `courseNames` is a `+`-separated list. The action ensures the batch exists,
 * assigns those courses to the batch, creates the student, and adds them to it.
 * Lines starting with `#` are ignored.
 */
export function parseBulkStudents(text: string): ParseResult<BulkStudentRow> {
  const rows: BulkStudentRow[] = [];
  const errors: ParseResult<BulkStudentRow>["errors"] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitRow(line);
    if (cells.length < 3) {
      errors.push({
        line: idx + 1,
        raw,
        reason: "expected studentCode,name,email[,batchCode[,courseNames]]",
      });
      return;
    }
    const [studentCode, name, email, batchCode, courseNamesRaw] = cells;
    if (!studentCode || !name || !email) {
      errors.push({ line: idx + 1, raw, reason: "missing required field" });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ line: idx + 1, raw, reason: "invalid email" });
      return;
    }
    if (!CODE_RE.test(studentCode)) {
      errors.push({ line: idx + 1, raw, reason: "invalid studentCode" });
      return;
    }
    rows.push({
      studentCode,
      name,
      email: email.toLowerCase(),
      batchCode: batchCode || undefined,
      courseNames: splitPlusList(courseNamesRaw),
    });
  });
  return { rows, errors };
}

// ---------- Add-students-to-a-batch rows ----------

export type BatchStudentRow = { email: string; studentCode: string; name: string };

/**
 * Company roster format (one course per sheet — see the shared file):
 *   <email>, <studentId> <name>
 * e.g. `seethaludayan4@gmail.com, KLM 2606 1282 Seethal U`
 *   → email, studentCode "KLM 2606 1282", name "Seethal U".
 *
 * The student id is admin-given (never auto-generated). The sheet's title row
 * ("Files To Share") and header row ("Mail ID", "<Course>") are skipped
 * automatically because their first cell isn't an email. Dedup against the DB
 * happens in the action, so re-uploading the same file only adds new rows.
 */
export function parseBatchStudents(text: string): ParseResult<BatchStudentRow> {
  const rows: BatchStudentRow[] = [];
  const errors: ParseResult<BatchStudentRow>["errors"] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitRow(line);
    const email = (cells[0] ?? "").trim().toLowerCase();
    // Title/header/blank rows have no email in column 1 — skip them silently.
    if (!EMAIL_RE.test(email)) return;
    const combined = (cells[1] ?? "").trim();
    if (!combined) {
      errors.push({ line: idx + 1, raw, reason: "missing student id + name in column 2" });
      return;
    }
    const m = combined.match(CODE_NAME_RE);
    if (!m) {
      errors.push({
        line: idx + 1,
        raw,
        reason: `couldn't read a student id + name from "${combined}"`,
      });
      return;
    }
    rows.push({
      email,
      studentCode: m[1].replace(/\s+/g, " ").trim(),
      name: m[2].replace(/\s+/g, " ").trim(),
    });
  });
  return { rows, errors };
}

/** Parse a list of identifiers (student codes or emails), one per line. */
export function parseIdentifierList(text: string): string[] {
  return text
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- Batches ----------

export type BulkBatchRow = {
  batchCode: string;
  batchName: string;
  description?: string;
  courseNames: string[];
};

/**
 * Accepts:
 *   batchCode,batchName[,description[,courseNames]]
 * courseNames is a `+`-separated list. Lines starting with `#` skipped.
 */
export function parseBulkBatches(text: string): ParseResult<BulkBatchRow> {
  const rows: BulkBatchRow[] = [];
  const errors: ParseResult<BulkBatchRow>["errors"] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitRow(line);
    if (cells.length < 2) {
      errors.push({
        line: idx + 1,
        raw,
        reason: "expected batchCode,batchName[,description[,courseNames]]",
      });
      return;
    }
    const [batchCode, batchName, description, courseNamesRaw] = cells;
    if (!batchCode || !batchName) {
      errors.push({ line: idx + 1, raw, reason: "missing batchCode or batchName" });
      return;
    }
    if (!/^[A-Za-z0-9 _-]+$/.test(batchCode)) {
      errors.push({ line: idx + 1, raw, reason: "invalid batchCode" });
      return;
    }
    rows.push({
      batchCode,
      batchName,
      description: description || undefined,
      courseNames: splitPlusList(courseNamesRaw),
    });
  });
  return { rows, errors };
}

// ---------- Courses ----------

export type BulkCourseRow = {
  name: string;
  description?: string;
  status?: "active" | "inactive";
};

/**
 * Accepts:
 *   name[,description[,status]]
 * `status` defaults to "active". Lines starting with `#` skipped.
 */
export function parseBulkCourses(text: string): ParseResult<BulkCourseRow> {
  const rows: BulkCourseRow[] = [];
  const errors: ParseResult<BulkCourseRow>["errors"] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitRow(line);
    const [name, description, statusRaw] = cells;
    if (!name) {
      errors.push({ line: idx + 1, raw, reason: "missing name" });
      return;
    }
    let status: "active" | "inactive" | undefined;
    if (statusRaw) {
      if (statusRaw === "active" || statusRaw === "inactive") status = statusRaw;
      else {
        errors.push({ line: idx + 1, raw, reason: "status must be active or inactive" });
        return;
      }
    }
    rows.push({
      name,
      description: description || undefined,
      ...(status ? { status } : {}),
    });
  });
  return { rows, errors };
}

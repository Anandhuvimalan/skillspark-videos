import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import ActionForm from "@/components/ActionForm";
import { getStudentsWithCourseAccess } from "@/lib/course-access";
import { getActiveBatches, getActiveCourses } from "@/lib/catalog-cache";
import { bulkAction, resolveStudentIdentifiers } from "@/actions/bulk";
import Dropdown from "@/components/Dropdown";

type SP = {
  courseId?: string;
  expired?: string;
  status?: string;
  batchId?: string;
};

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
];

const EXPIRY_OPTIONS = [
  { value: "", label: "Any expiry" },
  { value: "yes", label: "Expired" },
  { value: "no", label: "Not expired" },
];

const BULK_ACTIONS = [
  { value: "add_to_batch", label: "Add to batch" },
  { value: "remove_from_batch", label: "Remove from batch" },
  { value: "block", label: "Block students" },
  { value: "activate", label: "Activate students" },
  { value: "set_end_date", label: "Set access end date" },
];

async function loadResults(sp: SP) {
  if (!sp.courseId) return [] as any[];
  const ids = await getStudentsWithCourseAccess(sp.courseId);
  if (ids.length === 0) return [];

  const where: any = { id: { in: ids } };
  if (sp.status === "active" || sp.status === "blocked") where.status = sp.status;
  if (sp.batchId) where.studentBatches = { some: { batchId: sp.batchId } };
  if (sp.expired === "yes") where.accessEndDate = { lt: new Date() };
  if (sp.expired === "no")
    where.AND = [{ accessEndDate: { gte: new Date() } }, { accessStartDate: { lte: new Date() } }];
  return prisma.student.findMany({
    where,
    include: { studentBatches: { include: { batch: true } } },
    orderBy: { name: "asc" },
  });
}

export default async function AdminSearch({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const [courses, batches] = await Promise.all([getActiveCourses(), getActiveBatches()]);
  const students = await loadResults(sp);

  const courseOptions = [
    { value: "", label: "— pick a course —" },
    ...courses.map((c) => ({ value: c.id, label: c.name })),
  ];
  const batchOptions = [
    { value: "", label: "Any batch" },
    ...batches.map((b) => ({ value: b.id, label: b.batchCode, hint: b.batchName })),
  ];
  const targetBatchOptions = [
    { value: "", label: "— pick a batch —" },
    ...batches.map((b) => ({ value: b.id, label: b.batchCode, hint: b.batchName })),
  ];

  return (
    <div className="wide-canvas">
      <h1>Search &amp; bulk operations</h1>

      <h2>Filter results</h2>
      <form className="filter-bar" method="get">
        <Dropdown name="courseId" options={courseOptions} defaultValue={sp.courseId ?? ""} placeholder="Pick a course" label="Course" minWidth={220} />
        <Dropdown name="status" options={STATUS_OPTIONS} defaultValue={sp.status ?? ""} placeholder="Any status" label="Status" />
        <Dropdown name="batchId" options={batchOptions} defaultValue={sp.batchId ?? ""} placeholder="Any batch" label="Batch" minWidth={180} />
        <Dropdown name="expired" options={EXPIRY_OPTIONS} defaultValue={sp.expired ?? ""} placeholder="Any expiry" label="Expiry" />
        <button type="submit" className="filter-submit">Search</button>
      </form>

      {sp.courseId && (
        <div style={{ marginTop: "32px" }}>
          <h2>
            Results
            <span className="count-badge">{students.length}</span>
          </h2>
          {students.length === 0 ? (
            <p className="empty-state">No students have access to this course yet.</p>
          ) : (
            <ActionForm
              successMessage="Bulk action applied."
              action={async (fd: FormData) => {
                "use server";
                const action = String(fd.get("action") ?? "");
                const studentIds = fd.getAll("studentIds").map(String);
                if (studentIds.length === 0) return { ok: false, error: "Select at least one student." };
                const targetBatchId = String(fd.get("targetBatchId") ?? "") || undefined;
                const endDate = String(fd.get("endDate") ?? "") || undefined;
                return bulkAction({
                  action,
                  studentIds,
                  ...(action === "add_to_batch" || action === "remove_from_batch" ? { batchId: targetBatchId } : {}),
                  ...(action === "set_end_date" ? { endDate } : {}),
                });
              }}
            >
              <div className="add-student-panel">
                <div className="form-card-header">
                  <span>Bulk action parameters</span>
                </div>
                <div className="form-card-body">
                  <div className="form-grid">
                    <div className="form-field-group">
                      <Dropdown name="action" options={BULK_ACTIONS} defaultValue="add_to_batch" label="Action to perform" minWidth={240} />
                    </div>
                    <div className="form-field-group">
                      <Dropdown name="targetBatchId" options={targetBatchOptions} defaultValue="" placeholder="— pick a batch —" label="Target batch" minWidth={220} />
                    </div>
                    <div className="form-field-group">
                      <label>
                        End date (for set access end date)
                        <input name="endDate" type="date" />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <h3 style={{ marginTop: "24px", marginBottom: "12px" }}>Checked students to process</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th aria-label="Select" style={{ width: "40px" }}></th>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Batches</th>
                      <th>Status</th>
                      <th>Access until</th>
                      <th aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s: any) => (
                      <tr key={s.id}>
                        <td>
                          <input type="checkbox" name="studentIds" value={s.id} />
                        </td>
                        <td>
                          <code>{s.studentCode}</code>
                        </td>
                        <td>
                          <strong>{s.name}</strong>
                        </td>
                        <td className="cell-muted">{s.email}</td>
                        <td className="cell-muted">
                          {s.studentBatches.map((sb: any) => sb.batch.batchCode).join(", ") || "—"}
                        </td>
                        <td>
                          <span className="status-pill" data-tone={s.status === "active" ? undefined : "danger"}>
                            {s.status}
                          </span>
                        </td>
                        <td className="cell-muted">
                          {s.accessEndDate.toISOString().slice(0, 10).split("-").reverse().join("/")}
                        </td>
                        <td className="row-actions">
                          <Link href={`/admin/students/${s.id}`}>Edit</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions" style={{ marginTop: "16px" }}>
                <button type="submit">Run action on checked students</button>
              </div>
            </ActionForm>
          )}
        </div>
      )}

      <div className="add-student-panel" style={{ marginTop: "32px" }}>
        <div className="form-card-header">
          <span>Or paste student codes / emails</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Bulk action applied."
          action={async (fd: FormData) => {
            "use server";
            const text = String(fd.get("identifiers") ?? "");
            const action = String(fd.get("action") ?? "");
            const targetBatchId = String(fd.get("targetBatchId") ?? "") || undefined;
            const endDate = String(fd.get("endDate") ?? "") || undefined;

            const r1 = await resolveStudentIdentifiers(text);
            if (!r1.ok) return r1;
            if (r1.data.studentIds.length === 0)
              return { ok: false, error: `No matches; unknown: ${r1.data.unknown.join(", ")}` };

            return bulkAction({
              action,
              studentIds: r1.data.studentIds,
              ...(action === "add_to_batch" || action === "remove_from_batch" ? { batchId: targetBatchId } : {}),
              ...(action === "set_end_date" ? { endDate } : {}),
            });
          }}
        >
          <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
            Input one code or email per line. We resolve them to student records and run the bulk action.
          </p>
          <div className="form-field-group" style={{ marginBottom: "20px" }}>
            <label>
              Student identifiers (one per line)
              <textarea name="identifiers" rows={6} placeholder={"S001\nbob@example.com"} required />
            </label>
          </div>
          <div className="form-grid">
            <div className="form-field-group">
              <Dropdown name="action" options={BULK_ACTIONS} defaultValue="add_to_batch" label="Action" minWidth={240} />
            </div>
            <div className="form-field-group">
              <Dropdown name="targetBatchId" options={targetBatchOptions} defaultValue="" placeholder="— pick a batch —" label="Target batch" minWidth={220} />
            </div>
            <div className="form-field-group">
              <label>
                End date
                <input name="endDate" type="date" />
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Run on pasted students</button>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}

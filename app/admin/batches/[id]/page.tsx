import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { updateBatch, deleteBatch } from "@/actions/batches";
import { setBatchCourses, removeStudentFromBatch } from "@/actions/enrollments";
import { bulkAddStudentsToBatch } from "@/actions/bulk";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import ActionForm from "@/components/ActionForm";
import ActionButton from "@/components/ActionButton";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function BatchEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      batchCourses: { select: { courseId: true } },
      studentBatches: {
        include: { student: true },
        orderBy: { student: { name: "asc" } },
      },
    },
  });
  if (!batch) notFound();

  const courses = await prisma.course.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
  });
  const checkedCourses = batch.batchCourses.map((bc) => bc.courseId);
  const students = batch.studentBatches.map((sb) => sb.student);

  const today = new Date();
  const end = new Date(today);
  end.setMonth(end.getMonth() + 6);

  return (
    <div className="wide-canvas">
      <h1>Batch: {batch.batchCode}</h1>
      <p>
        Students in this batch can watch every course assigned below. Assign
        courses progressively as classes happen.
      </p>

      <div className="add-student-panel">
        <div className="form-card-header">
          <span>Batch profile</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Batch profile saved."
          action={async (fd: FormData) => {
            "use server";
            return updateBatch(id, {
              batchCode: fd.get("batchCode"),
              batchName: fd.get("batchName"),
              description: fd.get("description") || "",
            });
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Batch Code
                <input name="batchCode" defaultValue={batch.batchCode} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Batch Name
                <input name="batchName" defaultValue={batch.batchName} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Description
                <input name="description" defaultValue={batch.description ?? ""} />
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Save profile</button>
          </div>
        </ActionForm>
      </div>

      <div className="add-student-panel" style={{ marginTop: "24px" }}>
        <div className="form-card-header">
          <span>Courses assigned to this batch</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Batch courses saved."
          action={async (fd: FormData) => {
            "use server";
            return setBatchCourses({ batchId: id, courseIds: fd.getAll("courseIds") });
          }}
        >
          <p style={{ marginBottom: "20px", color: "var(--muted)", fontWeight: "500" }}>
            Tick to assign; untick to remove from all current and future students in this batch.
          </p>
          <MultiCheckPicker
            name="courseIds"
            legend="Courses"
            items={courses.map((c) => ({ id: c.id, label: c.name }))}
            defaultChecked={checkedCourses}
            placeholder="Search courses…"
          />
          <div className="form-actions">
            <button type="submit">Save courses</button>
          </div>
        </ActionForm>
      </div>

      <div className="add-student-panel" style={{ marginTop: "24px" }}>
        <div className="form-card-header">
          <span>Add students to this batch</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Students added to batch."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            fd.set("batchId", id);
            return bulkAddStudentsToBatch(fd);
          }}
        >
          <p style={{ marginBottom: "12px", color: "var(--muted)", fontWeight: 500 }}>
            One per line: <code>name,email</code> or <code>name,email,studentCode</code> (a bare email also works).
            Existing students are added to the batch; new ones are created.
          </p>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Access start
                <input type="date" name="defaultStartDate" defaultValue={isoDate(today)} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Access end
                <input type="date" name="defaultEndDate" defaultValue={isoDate(end)} required />
              </label>
            </div>
          </div>
          <div className="form-field-group">
            <label>
              Students
              <textarea name="text" rows={6} placeholder={"Jane Doe,jane@example.com\nbob@example.com"} />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit">Add students</button>
          </div>
        </ActionForm>
      </div>

      <h2 style={{ marginTop: "36px" }}>Students in batch ({students.length})</h2>
      {students.length === 0 ? (
        <p className="empty-state">No students in this batch.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Email</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>
                    <code>{s.studentCode}</code>
                  </td>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td className="cell-muted">{s.email}</td>
                  <td className="row-actions">
                    <Link className="row-btn" href={`/admin/students/${s.id}`}>Open</Link>
                    <ActionButton
                      action={async () => {
                        "use server";
                        return removeStudentFromBatch(s.id, id);
                      }}
                      successMessage={`Removed ${s.name} from batch.`}
                      confirm={`Remove ${s.name} from this batch?`}
                    >
                      Remove
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="danger-zone-box">
        <h2>Danger zone</h2>
        <p style={{ color: "#7f1d1d", fontWeight: "600", marginBottom: "16px" }}>
          Deleting this batch removes its students from the batch (and their access to its
          courses). The students themselves are not deleted.
        </p>
        <ActionButton
          action={async () => {
            "use server";
            return deleteBatch(id);
          }}
          successMessage={`Deleted batch “${batch.batchCode}”.`}
          confirm={`Delete batch “${batch.batchCode}”? Students are removed from it but not deleted.`}
          redirectTo="/admin/batches"
        >
          Delete batch
        </ActionButton>
      </div>
    </div>
  );
}

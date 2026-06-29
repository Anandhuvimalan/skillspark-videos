import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { updateStudent, deleteStudent } from "@/actions/students";
import { setStudentBatches } from "@/actions/enrollments";
import { getAccessibleCourses } from "@/lib/course-access";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import ActionForm from "@/components/ActionForm";

export default async function StudentEdit({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const student = await prisma.student.findUnique({
    where: { id },
    include: { studentBatches: { select: { batchId: true } } },
  });
  if (!student) notFound();

  const [batches, accessible] = await Promise.all([
    prisma.batch.findMany({ orderBy: { batchCode: "asc" } }),
    getAccessibleCourses(id),
  ]);
  const memberBatchIds = student.studentBatches.map((sb) => sb.batchId);

  return (
    <div className="wide-canvas">
      <h1>Edit student: {student.name}</h1>

      <div className="add-student-panel">
        <div className="form-card-header">
          <span>Student Profile</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Student profile saved successfully."
          action={async (fd: FormData) => {
            "use server";
            const r = await updateStudent(id, {
              studentCode: fd.get("studentCode"),
              name: fd.get("name"),
              email: fd.get("email"),
              status: fd.get("status"),
              accessStartDate: fd.get("accessStartDate"),
              accessEndDate: fd.get("accessEndDate"),
            });
            if (r.ok) revalidatePath(`/admin/students/${id}`);
            return r;
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Student Code
                <input name="studentCode" defaultValue={student.studentCode} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Full Name
                <input name="name" defaultValue={student.name} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Email Address
                <input name="email" type="email" defaultValue={student.email} required />
              </label>
            </div>
          </div>

          <div className="form-grid" style={{ marginTop: "12px" }}>
            <div className="form-field-group">
              <label>
                Account Status
                <select name="status" defaultValue={student.status}>
                  <option value="active">active</option>
                  <option value="blocked">blocked</option>
                </select>
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Access Start Date
                <input name="accessStartDate" type="date" defaultValue={student.accessStartDate.toISOString().slice(0, 10)} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Access End Date
                <input name="accessEndDate" type="date" defaultValue={student.accessEndDate.toISOString().slice(0, 10)} required />
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
          <span>Batches</span>
        </div>
        <ActionForm
          className="form-card-body"
          successMessage="Batch membership saved."
          action={async (fd: FormData) => {
            "use server";
            const r = await setStudentBatches({ studentId: id, batchIds: fd.getAll("batchIds") });
            if (r.ok) revalidatePath(`/admin/students/${id}`);
            return r;
          }}
        >
          <p style={{ marginBottom: "20px", color: "var(--muted)", fontWeight: "500" }}>
            Tick the batches this student belongs to. Their course access is the union of these
            batches&rsquo; assigned courses.
          </p>
          <MultiCheckPicker
            name="batchIds"
            legend="Batches"
            items={batches.map((b) => ({ id: b.id, label: `${b.batchCode} — ${b.batchName}` }))}
            defaultChecked={memberBatchIds}
            placeholder="Search batches…"
          />
          <div className="form-actions">
            <button type="submit">Save batches</button>
          </div>
        </ActionForm>
      </div>

      <h2 style={{ marginTop: "32px" }}>Effective course access ({accessible.length})</h2>
      <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
        Every active course the student can watch right now, via their batches.
      </p>
      {accessible.length === 0 ? (
        <p className="empty-state">No accessible courses — add the student to a batch that has courses.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Course</th>
              </tr>
            </thead>
            <tbody>
              {accessible.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
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
          Deleting this student permanently removes their batch memberships and progress. This
          action is irreversible.
        </p>
        <ActionForm
          successMessage="Student deleted successfully."
          redirectTo="/admin/students"
          confirm={`Delete ${student.name}? This permanently removes their records and cannot be undone.`}
          action={async () => {
            "use server";
            const r = await deleteStudent(id);
            if (r.ok) revalidatePath("/admin/students");
            return r;
          }}
        >
          <button type="submit">Delete student</button>
        </ActionForm>
      </div>
    </div>
  );
}

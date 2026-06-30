import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import { createBatch } from "@/actions/batches";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import ActionForm from "@/components/ActionForm";
import BatchesBrowser from "@/components/BatchesBrowser";

export default async function BatchesPage() {
  await requireAdmin();
  const [batches, courses] = await Promise.all([
    prisma.batch.findMany({
      orderBy: { batchCode: "asc" },
      include: {
        _count: {
          select: { studentBatches: true, batchCourses: true },
        },
      },
    }),
    prisma.course.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="wide-canvas">
      <h1>Batches</h1>
      <div className="add-student-panel" style={{ marginBottom: "32px" }}>
        <div className="form-card-header">
          <span>Add a New Batch</span>
        </div>
        <ActionForm
          className="form-card-body form-vertical"
          successMessage="Batch created."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return createBatch({
              batchCode: fd.get("batchCode"),
              batchName: fd.get("batchName"),
              description: fd.get("description") || "",
              courseIds: fd.getAll("courseIds"),
            });
          }}
        >
          <p style={{ color: "var(--muted)", fontWeight: "500", marginBottom: "16px" }}>
            Pick the courses to assign to everyone in this batch. You can add more
            courses later from the batch page as classes progress.
          </p>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Batch Code
                <input name="batchCode" placeholder="e.g. ONLB101" required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Batch Name
                <input name="batchName" placeholder="e.g. Online Batch 101" required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Description
                <input name="description" placeholder="Optional description..." />
              </label>
            </div>
          </div>
          <MultiCheckPicker
            name="courseIds"
            legend="Courses (assigned to batch)"
            items={courses.map((c) => ({ id: c.id, label: c.name }))}
            placeholder="Search courses…"
          />
          <div className="form-actions">
            <button type="submit">Create batch</button>
          </div>
        </ActionForm>
      </div>

      <BatchesBrowser
        batches={batches.map((b) => ({
          id: b.id,
          batchCode: b.batchCode,
          batchName: b.batchName,
          studentCount: b._count.studentBatches,
          courseCount: b._count.batchCourses,
        }))}
      />
    </div>
  );
}

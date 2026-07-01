import { Info, Upload } from "lucide-react";
import { requireAdmin } from "@/lib/authorization";
import {
  bulkAddStudentsToBatch,
  bulkAddStudentsFromForm,
  bulkAddBatchesFromForm,
  bulkAddCoursesFromForm,
} from "@/actions/bulk";
import { quickCreateBatch } from "@/actions/batches";
import { getDefaultEmailTemplate } from "@/lib/email-templates";
import BulkEmailFields from "@/components/BulkEmailFields";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import Dropdown from "@/components/Dropdown";
import ActionForm from "@/components/ActionForm";
import { getActiveBatches, getActiveCourses } from "@/lib/catalog-cache";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function BulkPage() {
  await requireAdmin();
  const [batches, courses, emailTemplate] = await Promise.all([
    getActiveBatches(),
    getActiveCourses(),
    getDefaultEmailTemplate(),
  ]);

  const batchOptions = [
    { value: "", label: "— pick a batch —" },
    ...batches.map((b) => ({ value: b.id, label: b.batchCode, hint: b.batchName })),
  ];
  const applyBatchOptions = [
    { value: "", label: "— none —" },
    ...batches.map((b) => ({ value: b.id, label: b.batchCode, hint: b.batchName })),
  ];

  const today = new Date();
  const end = new Date(today);
  end.setMonth(end.getMonth() + 6);

  return (
    <div className="adm wide-canvas">
      <header className="adm-head">
        <div className="adm-head-row">
          <div>
            <span className="adm-eyebrow">
              <Upload size={13} aria-hidden="true" />
              Import
            </span>
            <h1>Bulk operations</h1>
          </div>
        </div>
        <p className="adm-sub">
          Paste rows or upload a sheet. Existing records matched by their unique key are skipped, so
          re-uploading the same file is safe and only appends what&rsquo;s new.
        </p>
      </header>

      {/* Flow 1: add students to an existing batch */}
      <section className="adm-section">
        <div className="adm-section-head">
          <h2>Add students to a batch</h2>
          <span className="adm-meta">Students inherit the batch&rsquo;s courses.</span>
        </div>
        <ColumnSpec
          required={["email", "student id + name"]}
          optional={[]}
          notes={[
            "Paste/upload the shared roster: column 1 = email, column 2 = the student id followed by the name (e.g. KLM 2606 1282 Seethal U → id \"KLM 2606 1282\", name \"Seethal U\").",
            "The student id is admin-given (taken from the file), never auto-generated.",
            "The sheet's title/header rows are ignored automatically.",
            "Pick the batch first — students inherit its courses. No matching batch? Type a name in the batch box and choose “Add batch” to create it on the spot.",
            "Optionally tick courses below to assign them to the batch in the same step (handy for a brand-new batch).",
            "Already-added students (matched by email or id) are skipped, so re-uploading the same file with new rows only adds the new ones.",
          ]}
          example="seethaludayan4@gmail.com, KLM 2606 1282 Seethal U"
        />
        <ActionForm
          className="adm-form"
          successMessage="Students added to batch (and emailed, if selected)."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return bulkAddStudentsToBatch(fd);
          }}
        >
          <div className="form-grid">
            <div className="form-field-group">
              <Dropdown
                name="batchId"
                label="Batch"
                options={batchOptions}
                placeholder="— pick a batch —"
                minWidth={240}
                createLabel="Add batch"
                onCreate={async (label: string) => {
                  "use server";
                  return quickCreateBatch(label);
                }}
              />
            </div>
            <div className="form-field-group">
              <label>
                Access start
                <input name="defaultStartDate" type="date" defaultValue={isoDate(today)} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Access end
                <input name="defaultEndDate" type="date" defaultValue={isoDate(end)} required />
              </label>
            </div>
          </div>
          <div className="form-field-group">
            <label>
              Students (one per line: email, student id + name)
              <textarea
                name="text"
                rows={8}
                placeholder={"seethaludayan4@gmail.com, KLM 2606 1282 Seethal U\nabdulmajeed214@gmail.com, KLM 2606 1284 Alfiya A"}
              />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Or upload Excel / CSV / TXT
              <input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" />
            </label>
          </div>
          <div className="form-field-group">
            <MultiCheckPicker
              name="applyCourseIds"
              legend="Also assign courses to this batch (optional)"
              items={courses.map((c) => ({ id: c.id, label: c.name }))}
              placeholder="Search courses…"
            />
          </div>
          <BulkEmailFields
            defaultSubject={emailTemplate.subject}
            defaultBody={emailTemplate.body}
          />
          <div className="form-actions">
            <button type="submit">Add students to batch</button>
          </div>
        </ActionForm>
      </section>

      {/* Flow 2: full bootstrap */}
      <section className="adm-section">
        <div className="adm-section-head">
          <h2>Bulk add students (full bootstrap)</h2>
          <span className="adm-meta">Creates students, auto-creates batches, assigns courses.</span>
        </div>
        <ColumnSpec
          required={["studentCode", "name", "email"]}
          optional={["batchCode", "courseNames"]}
          notes={[
            "Separate multiple courses with a + (e.g. Excel+SQL).",
            "An unknown batchCode is auto-created; the named courses are assigned to that batch.",
            "Courses must already exist (create them in Bulk add courses first).",
            "Existing students (matched by email or studentCode) are skipped.",
          ]}
          example="S001,Alice,alice@example.com,ONLB101,Excel+SQL"
        />
        <ActionForm
          className="adm-form"
          successMessage="Students created."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return bulkAddStudentsFromForm(fd);
          }}
        >
          <div className="form-field-group">
            <label>
              Paste CSV (one student per line)
              <textarea
                name="text"
                rows={8}
                placeholder={
                  "# studentCode,name,email,batchCode,courseNames\n" +
                  "S001,Alice,alice@example.com,ONLB101,Excel+SQL\n" +
                  "S002,Bob,bob@example.com,ONLB101,Excel\n"
                }
              />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Or upload Excel / CSV / TXT
              <input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" />
            </label>
          </div>
          <div className="form-grid">
            <div className="form-field-group">
              <label>
                Default access start
                <input name="defaultStartDate" type="date" defaultValue={isoDate(today)} required />
              </label>
            </div>
            <div className="form-field-group">
              <label>
                Default access end
                <input name="defaultEndDate" type="date" defaultValue={isoDate(end)} required />
              </label>
            </div>
            <div className="form-field-group">
              <Dropdown name="applyBatchId" label="Also add everyone to batch (optional)" options={applyBatchOptions} placeholder="— none —" minWidth={240} />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Create students</button>
          </div>
        </ActionForm>
      </section>

      {/* Flow 3: bulk add batches */}
      <section className="adm-section">
        <div className="adm-section-head">
          <h2>Bulk add batches</h2>
        </div>
        <ColumnSpec
          required={["batchCode", "batchName"]}
          optional={["description", "courseNames"]}
          notes={[
            "Separate multiple courses with a + (e.g. Excel+SQL).",
            "Existing batches (matched by batchCode) are skipped.",
          ]}
          example="ONLB201,Online Batch 201,Spring intake,Excel+SQL"
        />
        <ActionForm
          className="adm-form"
          successMessage="Batches created."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return bulkAddBatchesFromForm(fd);
          }}
        >
          <div className="form-field-group">
            <label>
              Paste CSV (one batch per line)
              <textarea
                name="text"
                rows={6}
                placeholder={
                  "# batchCode,batchName,description,courseNames\n" +
                  "ONLB201,Online Batch 201,Spring intake,Excel+SQL\n"
                }
              />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Or upload Excel / CSV / TXT
              <input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" />
            </label>
          </div>
          <div className="form-field-group">
            <MultiCheckPicker
              name="applyCourseIds"
              legend="Apply these courses to every uploaded batch (optional)"
              items={courses.map((c) => ({ id: c.id, label: c.name }))}
              placeholder="Search courses…"
            />
          </div>
          <div className="form-actions">
            <button type="submit">Create batches</button>
          </div>
        </ActionForm>
      </section>

      {/* Flow 4: bulk add courses */}
      <section className="adm-section">
        <div className="adm-section-head">
          <h2>Bulk add courses</h2>
        </div>
        <ColumnSpec
          required={["name"]}
          optional={["description", "status"]}
          notes={[
            "status is either active (default) or inactive.",
            "Existing courses (matched by name) are skipped.",
          ]}
          example="Tally,Tally accounting basics,active"
        />
        <ActionForm
          className="adm-form"
          successMessage="Courses created."
          resetOnSuccess
          action={async (fd: FormData) => {
            "use server";
            return bulkAddCoursesFromForm(fd);
          }}
        >
          <div className="form-field-group">
            <label>
              Paste CSV (one course per line)
              <textarea
                name="text"
                rows={6}
                placeholder={"# name,description,status\nTally,Tally accounting basics,active\n"}
              />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Or upload Excel / CSV / TXT
              <input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit">Create courses</button>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}

function ColumnSpec({
  required,
  optional,
  notes,
  example,
}: {
  required: string[];
  optional: string[];
  notes?: string[];
  example?: string;
}) {
  return (
    <section className="column-spec" aria-label="File format">
      <div className="column-spec-grid">
        <div>
          <span className="column-spec-label">Required Fields</span>
          <div className="column-spec-tags">
            {required.map((c) => (
              <code key={c} data-tone="required">
                {c}
              </code>
            ))}
          </div>
        </div>
        {optional.length > 0 && (
          <div>
            <span className="column-spec-label">Optional Fields</span>
            <div className="column-spec-tags">
              {optional.map((c) => (
                <code key={c} data-tone="optional">
                  {c}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>
      {notes && notes.length > 0 ? (
        <ul className="column-spec-notes">
          {notes.map((n, i) => (
            <li key={i}>
              <Info size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }} />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {example ? (
        <div className="column-spec-example">
          <span className="column-spec-label">CSV Line Example</span>
          <pre>
            <code>{example}</code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}

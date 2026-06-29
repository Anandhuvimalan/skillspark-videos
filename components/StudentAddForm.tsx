"use client";

import { useActionState, useEffect, useRef } from "react";
import { AlertCircle, UserPlus } from "lucide-react";
import MultiCheckPicker from "@/components/MultiCheckPicker";
import { useToast } from "@/components/Toast";
import {
  createStudentFormAction,
  type StudentFormState,
} from "@/actions/students";

type Batch = { id: string; batchCode: string; batchName: string };

type Props = {
  batches: Batch[];
  /** Sensible defaults so the date fields don't trip the browser's
   *  `required` check on an empty submit. */
  defaultStartDate: string; // YYYY-MM-DD
  defaultEndDate: string;
};

const INITIAL: StudentFormState = { ok: true };

export default function StudentAddForm({
  batches,
  defaultStartDate,
  defaultEndDate,
}: Props) {
  const [state, formAction, pending] = useActionState(
    createStudentFormAction,
    INITIAL,
  );
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  const lastSubmittedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state.ok || !state.submittedAt) return;
    if (state.submittedAt === lastSubmittedAt.current) return;
    lastSubmittedAt.current = state.submittedAt;
    formRef.current?.reset();
    toast.success("Student added successfully.");
  }, [state, toast]);

  return (
    <details id="add-student" className="add-student-panel" open>
      <summary>
        <UserPlus size={16} aria-hidden="true" />
        <span>Add a new student</span>
      </summary>
      <p>Add the student to one or more batches — they can watch every course assigned to those batches.</p>

      {state.error && (
        <div className="form-banner form-banner-error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            <strong>Couldn&rsquo;t create the student.</strong> {state.error}
          </span>
        </div>
      )}

      <form ref={formRef} action={formAction}>
        <div className="form-grid">
          <div className="form-field-group">
            <label>
              Student Code
              <input name="studentCode" placeholder="e.g. STU101" required />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Full Name
              <input name="name" placeholder="e.g. John Doe" required />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Email Address
              <input
                name="email"
                placeholder="e.g. john@spark.com"
                type="email"
                required
              />
            </label>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-field-group">
            <label>
              Access Start Date
              <input
                name="accessStartDate"
                type="date"
                defaultValue={defaultStartDate}
                required
              />
            </label>
          </div>
          <div className="form-field-group">
            <label>
              Access End Date
              <input
                name="accessEndDate"
                type="date"
                defaultValue={defaultEndDate}
                required
              />
            </label>
          </div>
        </div>

        <MultiCheckPicker
          name="batchIds"
          legend="Batches"
          items={batches.map((b) => ({ id: b.id, label: `${b.batchCode} — ${b.batchName}` }))}
          placeholder="Search batches…"
        />

        <div className="form-actions">
          <button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create student account"}
          </button>
        </div>
      </form>
    </details>
  );
}

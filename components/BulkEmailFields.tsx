"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

type Props = {
  defaultSubject: string;
  defaultBody: string;
};

/**
 * Opt-in email block for the bulk "add students to a batch" form. When ticked,
 * it submits `sendEmail=on` plus the subject/body with the form; the server
 * action then mails every student in the uploaded list. Fields prefill from the
 * admin's default template and can be tweaked before submitting.
 */
export default function BulkEmailFields({ defaultSubject, defaultBody }: Props) {
  const [on, setOn] = useState(false);

  return (
    <div className="form-field-group">
      <label className="bulk-email-toggle">
        <input
          type="checkbox"
          name="sendEmail"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
        />
        <span>
          <Mail size={14} aria-hidden="true" /> Email these students their access instructions
        </span>
      </label>

      {on && (
        <div className="bulk-email-fields">
          <label>
            Email subject
            <input name="emailSubject" defaultValue={defaultSubject} maxLength={300} />
          </label>
          <label>
            Email message
            <textarea name="emailBody" rows={8} defaultValue={defaultBody} maxLength={20000} />
          </label>
          <p className="email-hint">
            Placeholders: <code>{"{{name}}"}</code> <code>{"{{email}}"}</code>{" "}
            <code>{"{{studentCode}}"}</code> <code>{"{{platformUrl}}"}</code> — filled per student.
            Each gets a private copy. Markdown supported (<code>**bold**</code>, <code>### heading</code>, lists).
          </p>
        </div>
      )}
    </div>
  );
}

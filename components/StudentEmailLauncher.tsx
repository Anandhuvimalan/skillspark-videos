"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { useToast } from "@/components/Toast";
import EmailComposer from "@/components/EmailComposer";
import { sendEmailToStudents } from "@/actions/email";

type Props = {
  defaultSubject: string;
  defaultBody: string;
};

/**
 * "Email selected" button for the Students roster. Reads the checked
 * `input[name="studentIds"]` boxes from its enclosing <form> (same DOM-based
 * selection the delete button uses), then opens the shared EmailComposer.
 * Only active/non-expired students are actually mailed — filtered server-side.
 */
export default function StudentEmailLauncher({ defaultSubject, defaultBody }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);

  const openWithSelection = (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = e.currentTarget.closest("form");
    const selected = Array.from(
      form?.querySelectorAll<HTMLInputElement>('input[name="studentIds"]:checked') ?? [],
    ).map((el) => el.value);
    if (selected.length === 0) {
      toast.error("Tick at least one student to email.");
      return;
    }
    setIds(selected);
    setOpen(true);
  };

  return (
    <>
      <button type="button" className="bulk-email-btn" onClick={openWithSelection}>
        <Mail size={14} aria-hidden="true" />
        Email selected
      </button>
      <EmailComposer
        open={open}
        onClose={() => setOpen(false)}
        audience={`${ids.length} selected`}
        defaultSubject={defaultSubject}
        defaultBody={defaultBody}
        onSend={(subject, body) => sendEmailToStudents({ studentIds: ids, subject, body })}
      />
    </>
  );
}

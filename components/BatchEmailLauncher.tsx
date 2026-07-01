"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import EmailComposer from "@/components/EmailComposer";
import { sendEmailToBatches } from "@/actions/email";

type Props = {
  batchId: string;
  batchLabel: string;
  defaultSubject: string;
  defaultBody: string;
};

/**
 * "Email this batch" quick-send on the batch detail page. Mails every
 * active/non-expired student in the batch (filtered server-side).
 */
export default function BatchEmailLauncher({
  batchId,
  batchLabel,
  defaultSubject,
  defaultBody,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="bulk-email-btn" onClick={() => setOpen(true)}>
        <Mail size={14} aria-hidden="true" />
        Email this batch
      </button>
      <EmailComposer
        open={open}
        onClose={() => setOpen(false)}
        audience={`batch ${batchLabel}`}
        defaultSubject={defaultSubject}
        defaultBody={defaultBody}
        onSend={(subject, body) => sendEmailToBatches({ batchIds: [batchId], subject, body })}
      />
    </>
  );
}

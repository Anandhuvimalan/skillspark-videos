"use client";

import { useEffect, useState, useTransition } from "react";
import { Mail, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { saveDefaultEmailTemplate, type EmailResult } from "@/actions/email";

type SendResult = { ok: true; data: EmailResult } | { ok: false; error: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Human description of who receives this, e.g. "3 selected students". */
  audience: string;
  defaultSubject: string;
  defaultBody: string;
  /** Sends the composed subject/body to the resolved recipients (server action). */
  onSend: (subject: string, body: string) => Promise<SendResult>;
};

/**
 * Shared compose-and-send modal. Prefilled from the admin's default template
 * ({{name}}, {{email}}, {{studentCode}}, {{platformUrl}} placeholders). Recipients
 * are resolved server-side by the caller's onSend — the composer only carries the
 * message. "Save as default" persists the current text for next time.
 */
export default function EmailComposer({
  open,
  onClose,
  audience,
  defaultSubject,
  defaultBody,
  onSend,
}: Props) {
  const toast = useToast();
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, startSend] = useTransition();
  const [savingTpl, startSave] = useTransition();

  // Re-seed from the template each time the modal opens.
  useEffect(() => {
    if (open) {
      setSubject(defaultSubject);
      setBody(defaultBody);
    }
  }, [open, defaultSubject, defaultBody]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, sending, onClose]);

  if (!open) return null;

  const send = () =>
    startSend(async () => {
      const r = await onSend(subject, body);
      if (r.ok) {
        const { sent, failed, skipped } = r.data;
        const extra = [
          failed.length ? `${failed.length} failed` : "",
          skipped.length ? `${skipped.length} skipped` : "",
        ]
          .filter(Boolean)
          .join(", ");
        toast.success(`Sent ${sent} email${sent === 1 ? "" : "s"}${extra ? ` (${extra})` : ""}.`);
        onClose();
      } else {
        toast.error(r.error || "Couldn't send emails.");
      }
    });

  const saveDefault = () =>
    startSave(async () => {
      const r = await saveDefaultEmailTemplate({ subject, body });
      if (r.ok) toast.success("Saved as the default template.");
      else toast.error(r.error || "Couldn't save template.");
    });

  return (
    <div
      className="email-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Compose email"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className="email-modal">
        <div className="email-modal-head">
          <h2>
            <Mail size={16} aria-hidden="true" /> Email {audience}
          </h2>
          <button type="button" className="email-modal-close" onClick={onClose} disabled={sending} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="email-modal-body">
          <label className="email-field">
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
          </label>
          <label className="email-field">
            <span>Message</span>
            <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
          </label>
          <p className="email-hint">
            Placeholders: <code>{"{{name}}"}</code> <code>{"{{email}}"}</code>{" "}
            <code>{"{{studentCode}}"}</code> <code>{"{{platformUrl}}"}</code> — each is filled in per student.
            Every recipient gets their own private copy. Markdown is supported
            (<code>**bold**</code>, <code>### heading</code>, <code>- list</code>, <code>&gt; quote</code>).
          </p>
        </div>

        <div className="email-modal-actions">
          <button type="button" className="ghost-button" onClick={saveDefault} disabled={sending || savingTpl}>
            {savingTpl ? "Saving…" : "Save as default"}
          </button>
          <div className="email-modal-actions-right">
            <button type="button" className="ghost-button" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button type="button" className="email-send-btn" onClick={send} disabled={sending}>
              {sending ? "Sending…" : `Send to ${audience}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

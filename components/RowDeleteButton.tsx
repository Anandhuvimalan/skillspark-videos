"use client";

import { Trash2 } from "lucide-react";
import ActionButton from "@/components/ActionButton";
import { deleteBatch } from "@/actions/batches";
import { deleteStudent } from "@/actions/students";

type Kind = "batch" | "student";

const ACTIONS: Record<Kind, (id: string) => Promise<{ ok: boolean; error?: string }>> = {
  batch: deleteBatch,
  student: deleteStudent,
};

/**
 * Toast-backed delete button for entity list rows (batches, packages). Keeps
 * the action closure on the client so the imported server action can be called
 * directly with the row id.
 */
export default function RowDeleteButton({
  kind,
  id,
  label,
  redirectTo,
}: {
  kind: Kind;
  id: string;
  label: string;
  redirectTo?: string;
}) {
  return (
    <ActionButton
      action={() => ACTIONS[kind](id)}
      successMessage={`Deleted “${label}”.`}
      confirm={`Delete “${label}”? This cannot be undone.`}
      redirectTo={redirectTo}
      className="row-delete"
      ariaLabel={`Delete ${label}`}
    >
      <Trash2 size={12} aria-hidden="true" />
    </ActionButton>
  );
}

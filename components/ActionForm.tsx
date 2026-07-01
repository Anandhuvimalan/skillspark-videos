"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

type ActionResult = { ok: boolean; error?: string; data?: unknown };

type InternalState = ActionResult & { _t: number };

const INITIAL: InternalState = { ok: true, _t: 0 };

type Props = {
  /**
   * A server action that returns `{ ok, error? }` (the project's `R` shape).
   * Pass an inline `"use server"` closure or a top-level action — both work as
   * props to this client component.
   */
  action: (formData: FormData) => Promise<ActionResult>;
  /** Success toast when the action resolves `{ ok: true }`. Either a fixed
   *  string, or a function of the action's returned `data` for a dynamic
   *  message (e.g. "Added 12 · emailed 12"). */
  successMessage: string | ((data: unknown) => string);
  /** Optional client-side navigation after success (e.g. delete → list). The
   *  toast survives the navigation because ToastProvider lives in the layout. */
  redirectTo?: string;
  /** If set, a native confirm() must be accepted before the action fires. */
  confirm?: string;
  /** Reset the form fields after a successful submit. */
  resetOnSuccess?: boolean;
  className?: string;
  children: React.ReactNode;
};

/**
 * Drop-in replacement for `<form action={serverAction}>` that surfaces a toast
 * on success/failure instead of throwing. Keeps the server action returning its
 * normal `R` result — no `throw` needed at the call site.
 */
export default function ActionForm({
  action,
  successMessage,
  redirectTo,
  confirm,
  resetOnSuccess,
  className,
  children,
}: Props) {
  const toast = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef(0);

  const [state, formAction, pending] = useActionState(
    async (_prev: InternalState, formData: FormData): Promise<InternalState> => {
      const r = await action(formData);
      return { ...r, _t: Date.now() };
    },
    INITIAL,
  );

  useEffect(() => {
    if (!state._t || state._t === seen.current) return;
    seen.current = state._t;
    if (state.ok) {
      toast.success(
        typeof successMessage === "function" ? successMessage(state.data) : successMessage,
      );
      if (resetOnSuccess) formRef.current?.reset();
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        // Guarantee the current route reflects the mutation even when the
        // action only revalidated a sibling path (e.g. the list, not [id]).
        router.refresh();
      }
    } else {
      toast.error(state.error || "Something went wrong.");
    }
  }, [state, successMessage, redirectTo, resetOnSuccess, toast, router]);

  return (
    <form
      ref={formRef}
      className={className}
      action={formAction}
      data-pending={pending ? "true" : undefined}
      onSubmit={
        confirm
          ? (e) => {
              if (!window.confirm(confirm)) e.preventDefault();
            }
          : undefined
      }
    >
      {children}
    </form>
  );
}

"use client";

/**
 * Header checkbox that toggles every `input[name="studentIds"]` in its enclosing
 * <form>. Pure DOM toggle so it works over server-rendered rows without lifting
 * the whole table into client state.
 */
export default function SelectAllCheckbox() {
  return (
    <input
      type="checkbox"
      aria-label="Select all on this page"
      onChange={(e) => {
        const form = e.currentTarget.closest("form");
        form
          ?.querySelectorAll<HTMLInputElement>('input[name="studentIds"]')
          .forEach((el) => {
            el.checked = e.currentTarget.checked;
          });
      }}
    />
  );
}

"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

type Chip = { key: string; label: string };

type Props = {
  chips: Chip[];
  basePath: string;
  /** Current query params, used to rebuild the URL minus the cleared key. */
  searchParams: Record<string, string | undefined>;
};

/**
 * Active-filter chips that clear a single filter (or all) without a full page
 * navigation. Uses router.replace inside a transition so the click registers
 * instantly (the bar dims + disables while the filtered view streams in) and
 * the back button isn't littered with every filter tweak.
 */
export default function FilterChips({ chips, basePath, searchParams }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Warm the most common clear ("Clear all" → unfiltered list) so it lands fast.
  useEffect(() => {
    if (chips.length > 0) router.prefetch(basePath);
  }, [router, basePath, chips.length]);

  if (chips.length === 0) return null;

  const hrefWithout = (key: string) => {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([k, v]) => {
      if (v && v !== "" && k !== key && k !== "page") params.set(k, v);
    });
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const go = (href: string) =>
    startTransition(() => router.replace(href, { scroll: false }));

  return (
    <div
      className="filter-chips"
      role="list"
      aria-label="Active filters"
      aria-busy={pending}
      data-pending={pending ? "true" : undefined}
    >
      <span className="filter-chips-label">Active filters</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="filter-chip"
          role="listitem"
          aria-label={`Clear ${chip.label}`}
          disabled={pending}
          onClick={() => go(hrefWithout(chip.key))}
        >
          <span>{chip.label}</span>
          <X size={12} aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        className="filter-chip filter-chip--clear"
        disabled={pending}
        onClick={() => go(basePath)}
      >
        Clear all
      </button>
    </div>
  );
}

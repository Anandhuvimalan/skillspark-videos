"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  /** Called with the requested page (already clamped to [1, totalPages]). */
  onPage: (p: number) => void;
};

/**
 * Client-side sibling of <Pagination>: same look (reuses the `.pagination`
 * classes) but drives an in-memory list via a callback instead of URL params.
 * Used by the course/batch browsers, which filter and page on the client.
 */
export default function Pager({ page, totalPages, total, pageSize, onPage }: Props) {
  if (total === 0 || totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const visible = computeVisible(page, totalPages);
  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination-meta">
        Showing <strong>{start.toLocaleString()}</strong>–
        <strong>{end.toLocaleString()}</strong> of{" "}
        <strong>{total.toLocaleString()}</strong>
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-btn"
          data-disabled={isFirst ? "true" : undefined}
          disabled={isFirst}
          onClick={() => onPage(page - 1)}
          rel="prev"
        >
          <ChevronLeft size={14} aria-hidden="true" />
          Prev
        </button>

        {visible.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="pagination-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className="pagination-btn pagination-num"
              data-active={p === page ? "true" : undefined}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          className="pagination-btn"
          data-disabled={isLast ? "true" : undefined}
          disabled={isLast}
          onClick={() => onPage(page + 1)}
          rel="next"
        >
          Next
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

function computeVisible(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  if (current > 3) out.push("…");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    out.push(i);
  }
  if (current < total - 2) out.push("…");
  out.push(total);
  return out;
}

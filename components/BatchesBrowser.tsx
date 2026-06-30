"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Search, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import ActionButton from "@/components/ActionButton";
import Pager from "@/components/Pager";
import { deleteBatch } from "@/actions/batches";

const PAGE_SIZE = 10;

type BatchRow = {
  id: string;
  batchCode: string;
  batchName: string;
  studentCount: number;
  courseCount: number;
};

export default function BatchesBrowser({ batches }: { batches: BatchRow[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter(
      (b) =>
        b.batchCode.toLowerCase().includes(q) ||
        b.batchName.toLowerCase().includes(q),
    );
  }, [batches, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Reset to page 1 whenever the result set shrinks below the current page.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="browser">
      <div className="browser-toolbar">
        <h2>All batches</h2>
        <div className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search batches by code or name…"
            aria-label="Search batches"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">
          {batches.length === 0
            ? "No batches created yet."
            : `No batches match “${query}”.`}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Students</th>
                <th>Courses</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((b) => (
                <tr key={b.id}>
                  <td>
                    <code>{b.batchCode}</code>
                  </td>
                  <td>
                    <strong>{b.batchName}</strong>
                  </td>
                  <td>{b.studentCount}</td>
                  <td>{b.courseCount}</td>
                  <td className="row-actions">
                    <Link className="row-btn" href={`/admin/batches/${b.id}`}>
                      <SquareArrowOutUpRight size={13} aria-hidden="true" />
                      Open
                    </Link>
                    <Link className="row-btn" href={`/admin/batches/${b.id}#edit`}>
                      <Pencil size={13} aria-hidden="true" />
                      Edit
                    </Link>
                    <ActionButton
                      action={() => deleteBatch(b.id)}
                      successMessage={`Deleted batch “${b.batchCode}”.`}
                      confirm={`Delete batch “${b.batchCode}”? Students are removed from it but not deleted.`}
                      className="row-delete"
                      ariaLabel={`Delete ${b.batchCode}`}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={page}
            totalPages={totalPages}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        </div>
      )}
    </div>
  );
}

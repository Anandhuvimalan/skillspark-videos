import Link from "next/link";
import {
  ArrowUpRight,
  Layers3,
  Search,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authorization";
import RowDeleteButton from "@/components/RowDeleteButton";
import Dropdown from "@/components/Dropdown";
import Pagination from "@/components/Pagination";
import StudentAddForm from "@/components/StudentAddForm";
import { getActiveBatches, getActiveCourses } from "@/lib/catalog-cache";
import { getStudentsWithCourseAccess } from "@/lib/course-access";

const PAGE_SIZE = 10;

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    batchId?: string;
    courseId?: string;
    expired?: string;
    page?: string;
  }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const where: any = {};
  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q } },
      { email: { contains: sp.q.toLowerCase() } },
      { studentCode: { contains: sp.q } },
    ];
  }
  if (sp.status === "active" || sp.status === "blocked") where.status = sp.status;
  if (sp.batchId) where.studentBatches = { some: { batchId: sp.batchId } };
  const now = new Date();
  if (sp.expired === "yes") where.accessEndDate = { lt: now };
  if (sp.expired === "no")
    where.AND = [{ accessEndDate: { gte: now } }, { accessStartDate: { lte: now } }];

  if (sp.courseId) {
    const ids = await getStudentsWithCourseAccess(sp.courseId);
    where.id = { in: ids.length ? ids : ["__none__"] };
  }

  const [
    filteredCount,
    students,
    batches,
    courses,
    totalCount,
    activeCount,
    blockedCount,
    expiredCount,
  ] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      include: { studentBatches: { include: { batch: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getActiveBatches(),
    getActiveCourses(),
    prisma.student.count(),
    prisma.student.count({ where: { status: "active" } }),
    prisma.student.count({ where: { status: "blocked" } }),
    prisma.student.count({ where: { accessEndDate: { lt: now } } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  // Default values seeded into the add-student form so the browser's
  // `required` validation doesn't silently block submission on empty dates.
  const today = new Date();
  const inOneYear = new Date(today);
  inOneYear.setFullYear(inOneYear.getFullYear() + 1);
  const addFormDefaultStart = today.toISOString().slice(0, 10);
  const addFormDefaultEnd = inOneYear.toISOString().slice(0, 10);

  const statusOptions = [
    { value: "", label: "Any status" },
    { value: "active", label: "Active" },
    { value: "blocked", label: "Blocked" },
  ];

  const expiryOptions = [
    { value: "", label: "Any expiry" },
    { value: "yes", label: "Expired" },
    { value: "no", label: "Not expired" },
  ];

  const batchOptions = [
    { value: "", label: "Any batch" },
    ...batches.map((b) => ({
      value: b.id,
      label: b.batchCode,
      hint: b.batchName,
    })),
  ];

  const courseOptions = [
    { value: "", label: "Any course" },
    ...courses.map((c) => ({ value: c.id, label: c.name })),
  ];

  const formatDate = (d: Date) =>
    d.toISOString().slice(0, 10).split("-").reverse().join("/");

  const monogram = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "—";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  };

  const buildFilterHrefWithout = (key: string) => {
    const params = new URLSearchParams();
    Object.entries(sp).forEach(([k, v]) => {
      if (v && v !== "" && k !== key && k !== "page") params.set(k, v);
    });
    const qs = params.toString();
    return qs ? `/admin/students?${qs}` : "/admin/students";
  };

  // KPI tiles double as one-click roster filters. `patch` overrides the
  // current query (undefined removes a key); page always resets to 1.
  const buildKpiHref = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...sp, ...patch };
    const params = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v && v !== "" && k !== "page") params.set(k, v);
    });
    const qs = params.toString();
    return qs ? `/admin/students?${qs}` : "/admin/students";
  };

  const kpiTiles = [
    {
      tone: "total",
      label: "Total",
      value: totalCount,
      active: !sp.status && !sp.expired,
      href: buildKpiHref({ status: undefined, expired: undefined }),
      title: "Show all students",
    },
    {
      tone: "active",
      label: "Active",
      value: activeCount,
      active: sp.status === "active",
      href:
        sp.status === "active"
          ? buildKpiHref({ status: undefined })
          : buildKpiHref({ status: "active" }),
      title: sp.status === "active" ? "Clear status filter" : "Filter: active students",
    },
    {
      tone: "blocked",
      label: "Blocked",
      value: blockedCount,
      active: sp.status === "blocked",
      href:
        sp.status === "blocked"
          ? buildKpiHref({ status: undefined })
          : buildKpiHref({ status: "blocked" }),
      title: sp.status === "blocked" ? "Clear status filter" : "Filter: blocked students",
    },
    {
      tone: "expired",
      label: "Expired",
      value: expiredCount,
      active: sp.expired === "yes",
      href:
        sp.expired === "yes"
          ? buildKpiHref({ expired: undefined })
          : buildKpiHref({ expired: "yes" }),
      title: sp.expired === "yes" ? "Clear expiry filter" : "Filter: expired access",
    },
  ] as const;

  const rangeStart = filteredCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, filteredCount);

  const batchLabel = (id: string) =>
    batches.find((b) => b.id === id)?.batchCode ?? id.slice(0, 8);
  const courseLabel = (id: string) =>
    courses.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const activeChips: { key: string; label: string }[] = [];
  if (sp.q) activeChips.push({ key: "q", label: `Search: "${sp.q}"` });
  if (sp.status) activeChips.push({ key: "status", label: `Status: ${sp.status}` });
  if (sp.batchId)
    activeChips.push({ key: "batchId", label: `Batch: ${batchLabel(sp.batchId)}` });
  if (sp.expired)
    activeChips.push({
      key: "expired",
      label: sp.expired === "yes" ? "Expired only" : "Not expired only",
    });
  if (sp.courseId)
    activeChips.push({ key: "courseId", label: `Course: ${courseLabel(sp.courseId)}` });

  return (
    <div className="wide-canvas students-page">
      <header className="students-hero">
        <div className="students-hero-text">
          <span className="eyebrow">
            <Users size={14} aria-hidden="true" />
            Roster
          </span>
          <h1>Students</h1>
          <p>
            Manage learner access through batches. Apply filters below to narrow the roster.
          </p>
        </div>
        <div className="students-hero-stats" role="list" aria-label="Roster segments — click to filter">
          {kpiTiles.map((tile) => (
            <Link
              key={tile.label}
              href={tile.href}
              className="kpi kpi--link"
              data-tone={tile.tone}
              data-active={tile.active ? "true" : undefined}
              role="listitem"
              title={tile.title}
            >
              <span className="kpi-label">{tile.label}</span>
              <span className="kpi-value">{tile.value}</span>
              <span className="kpi-filter-hint" aria-hidden="true">
                {tile.active ? "Filtering · click to clear" : "Click to filter"}
              </span>
            </Link>
          ))}
        </div>
      </header>

      <div className="quick-actions" aria-label="Shortcuts">
        <Link href="#add-student" className="quick-action" data-tone="violet">
          <UserPlus size={16} aria-hidden="true" />
          <span>
            <strong>Add a student</strong>
            <small>Single enrollment</small>
          </span>
        </Link>
        <Link href="/admin/bulk" className="quick-action" data-tone="cyan">
          <Upload size={16} aria-hidden="true" />
          <span>
            <strong>Bulk import</strong>
            <small>CSV upload</small>
          </span>
        </Link>
        <Link href="/admin/batches" className="quick-action" data-tone="rose">
          <Layers3 size={16} aria-hidden="true" />
          <span>
            <strong>Manage batches</strong>
            <small>{batches.length} configured</small>
          </span>
        </Link>
      </div>

      <form className="filter-bar" method="get" aria-label="Filter students">
        <div className="search-input">
          <Search size={16} aria-hidden="true" />
          <input
            name="q"
            placeholder="Search code, name, or email"
            defaultValue={sp.q ?? ""}
            aria-label="Search students"
          />
        </div>
        <Dropdown
          name="status"
          options={statusOptions}
          defaultValue={sp.status ?? ""}
          placeholder="Any status"
          ariaLabel="Filter by status"
        />
        <Dropdown
          name="batchId"
          options={batchOptions}
          defaultValue={sp.batchId ?? ""}
          placeholder="Any batch"
          ariaLabel="Filter by batch"
          minWidth={200}
        />
        <Dropdown
          name="expired"
          options={expiryOptions}
          defaultValue={sp.expired ?? ""}
          placeholder="Any expiry"
          ariaLabel="Filter by expiry"
        />
        <Dropdown
          name="courseId"
          options={courseOptions}
          defaultValue={sp.courseId ?? ""}
          placeholder="Any course"
          ariaLabel="Filter by course access"
          minWidth={200}
        />
        <button type="submit" className="filter-submit">
          Apply filters
        </button>
      </form>

      {activeChips.length > 0 && (
        <div className="filter-chips" role="list" aria-label="Active filters">
          <span className="filter-chips-label">Active filters</span>
          {activeChips.map((chip) => (
            <Link
              key={chip.key}
              href={buildFilterHrefWithout(chip.key)}
              className="filter-chip"
              role="listitem"
              aria-label={`Clear ${chip.label}`}
            >
              <span>{chip.label}</span>
              <X size={12} aria-hidden="true" />
            </Link>
          ))}
          <Link href="/admin/students" className="filter-chip filter-chip--clear">
            Clear all
          </Link>
        </div>
      )}

      <div className="results-head">
        <h2>
          Results
          <span className="count-badge">{filteredCount.toLocaleString()}</span>
        </h2>
        <span className="results-meta">
          {filteredCount === 0
            ? "No matches"
            : `Showing ${rangeStart}–${rangeEnd} of ${filteredCount.toLocaleString()}`}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Student</th>
              <th>Batch</th>
              <th>Status</th>
              <th>Access window</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty">
                  No students match the current filters.
                </td>
              </tr>
            )}
            {students.map((s) => {
              const expired = s.accessEndDate < now;
              const daysLeft = Math.ceil(
                (s.accessEndDate.getTime() - now.getTime()) / 86_400_000,
              );
              const pillTone =
                s.status === "blocked" ? "danger" : expired ? "warn" : undefined;
              const pillLabel =
                s.status === "blocked" ? "blocked" : expired ? "expired" : "active";
              return (
                <tr key={s.id}>
                  <td>
                    <code>{s.studentCode}</code>
                  </td>
                  <td>
                    <span className="student-name-cell">
                      <span
                        className="student-mono"
                        data-tone={["violet", "cyan", "rose", "blue", "amber"][
                          Math.abs(
                            Array.from(s.name).reduce(
                              (h, c) => (h * 31 + c.charCodeAt(0)) | 0,
                              0,
                            ),
                          ) % 5
                        ]}
                      >
                        {monogram(s.name)}
                      </span>
                      <span className="student-id-stack">
                        <strong>{s.name}</strong>
                        <small>{s.email}</small>
                      </span>
                    </span>
                  </td>
                  <td>
                    {s.studentBatches.length > 0 ? (
                      <span className="batch-chips">
                        {s.studentBatches.map((sb) => (
                          <span key={sb.batchId} className="batch-chip" title={sb.batch.batchName}>
                            {sb.batch.batchCode}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="cell-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className="status-pill" data-tone={pillTone}>
                      {pillLabel}
                    </span>
                  </td>
                  <td className="cell-muted">
                    <span className="access-cell">
                      <span className="access-window">
                        <span>{formatDate(s.accessStartDate)}</span>
                        <span aria-hidden="true">→</span>
                        <span data-expired={expired}>{formatDate(s.accessEndDate)}</span>
                      </span>
                      {expired ? (
                        <span className="days-chip" data-tone="danger">
                          ended {Math.abs(daysLeft)}d ago
                        </span>
                      ) : daysLeft <= 30 ? (
                        <span
                          className="days-chip"
                          data-tone={daysLeft <= 7 ? "danger" : "warn"}
                        >
                          {daysLeft}d left
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="row-actions">
                    <Link className="row-btn" href={`/admin/students/${s.id}`}>
                      Edit
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </Link>
                    <RowDeleteButton kind="student" id={s.id} label={s.name} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={filteredCount}
        pageSize={PAGE_SIZE}
        basePath="/admin/students"
        searchParams={sp}
      />

      <StudentAddForm
        batches={batches}
        defaultStartDate={addFormDefaultStart}
        defaultEndDate={addFormDefaultEnd}
      />
    </div>
  );
}

import {
  Activity,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock,
  GraduationCap,
  Layers3,
  PlayCircle,
  ScrollText,
  StickyNote,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { requireAdmin } from "@/lib/authorization";
import {
  getKpiSnapshot,
  getDailyActivity,
  getTopCourses,
  getTopStudents,
  getCompletionByCourse,
  getAuditActivity,
  secondsToReadable,
} from "@/lib/admin-analytics";
import {
  DailyActivityChart,
  TopWatchBar,
  CompletionBar,
  StudentStatusDonut,
  CatalogDonut,
  AuditActivityBar,
} from "@/components/charts/AdminCharts";

export default async function AdminHome() {
  await requireAdmin();
  const [kpi, daily, topCourses, topStudents, completion, auditActivity] = await Promise.all([
    getKpiSnapshot(),
    getDailyActivity(30),
    getTopCourses(8),
    getTopStudents(8),
    getCompletionByCourse(8),
    getAuditActivity(30),
  ]);

  const watchHours = Math.round((kpi.watch.totalSeconds / 3600) * 10) / 10;

  return (
    <div className="wide-canvas admin-home">
      <header className="admin-home-hero">
        <div>
          <span className="eyebrow">
            <Activity size={14} aria-hidden="true" />
            Overview
          </span>
          <h1>Admin home</h1>
          <p>
            Learning catalog, engagement metrics, and operational pulse — last 30 days unless
            stated otherwise.
          </p>
        </div>
      </header>

      {/* ---------- KPI strip ---------- */}
      <section className="kpi-strip" aria-label="Headline metrics">
        <KpiCard
          icon={Users}
          label="Active students"
          value={kpi.totals.activeStudents.toLocaleString()}
          hint={`${kpi.totals.students.toLocaleString()} total`}
          tone="green"
        />
        <KpiCard
          icon={Clock}
          label="Total watch time"
          value={`${watchHours.toLocaleString()}h`}
          hint={`${kpi.watch.completedVideos.toLocaleString()} videos completed`}
          tone="cyan"
        />
        <KpiCard
          icon={TrendingUp}
          label="Learners (30d)"
          value={kpi.watch.activeLearners30d.toLocaleString()}
          hint="Unique students with progress"
          tone="purple"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Avg completion"
          value={`${kpi.watch.overallCompletionPct}%`}
          hint={`${kpi.watch.inProgressVideos} in progress`}
          tone="orange"
        />
        <KpiCard
          icon={Clock}
          label="Per-student avg"
          value={secondsToReadable(kpi.watch.avgSecondsPerStudent)}
          hint="Across all students"
          tone="dark"
        />
      </section>

      {/* ---------- Catalog roll-up — companion band to the KPI strip ---------- */}
      <section className="catalog-band" aria-label="Catalog totals">
        <CatalogStat icon={Users} label="Students" value={kpi.totals.students} tone="blue" />
        <CatalogStat icon={Layers3} label="Batches" value={kpi.totals.batches} tone="cyan" />
        <CatalogStat icon={BookOpen} label="Courses" value={kpi.totals.courses} tone="green" />
        <CatalogStat icon={ClipboardList} label="Modules" value={kpi.totals.modules} tone="orange" />
        <CatalogStat icon={PlayCircle} label="Videos" value={kpi.totals.videos} tone="rose" />
        <CatalogStat icon={StickyNote} label="Notes" value={kpi.totals.notes} tone="slate" />
        <CatalogStat icon={ScrollText} label="Audit events" value={kpi.totals.auditEvents} tone="dark" />
      </section>

      {/* ---------- Primary chart row ---------- */}
      <section className="chart-grid">
        <article className="chart-card chart-card-wide">
          <header>
            <span className="chart-eyebrow">Engagement · last 30 days</span>
            <h2>Daily activity</h2>
            <p>Unique active learners and total progress events per day.</p>
          </header>
          <div className="chart-canvas chart-canvas-tall">
            <DailyActivityChart data={daily} />
          </div>
        </article>

        <article className="chart-card">
          <header>
            <span className="chart-eyebrow">Cohort breakdown</span>
            <h2>Student status</h2>
            <p>Active vs expired vs blocked.</p>
          </header>
          <div className="chart-canvas chart-canvas-tall">
            <StudentStatusDonut
              active={kpi.totals.activeStudents}
              blocked={kpi.totals.blockedStudents}
              expired={kpi.totals.expiredStudents}
            />
          </div>
        </article>
      </section>

      {/* ---------- Pulse strip filler — keeps the gap between chart rows
              feeling intentional and on-brand. ---------- */}
      <section className="admin-pulse-strip" aria-label="Engagement pulse">
        <div>
          <span className="pulse-eyebrow">
            <Zap size={12} aria-hidden="true" />
            Live snapshot
          </span>
          <h3>Learning pulse</h3>
          <p>
            A quick read on how the catalog is moving — completions, the most
            active learners, and the catalog&apos;s overall reach.
          </p>
        </div>
        <div className="admin-pulse-grid">
          <div className="admin-pulse-cell" data-tone="green">
            <small>Completion</small>
            <strong>{kpi.watch.overallCompletionPct}%</strong>
          </div>
          <div className="admin-pulse-cell" data-tone="purple">
            <small>Watch hours</small>
            <strong>{watchHours.toLocaleString()}h</strong>
          </div>
          <div className="admin-pulse-cell" data-tone="orange">
            <small>Learners 30d</small>
            <strong>{kpi.watch.activeLearners30d.toLocaleString()}</strong>
          </div>
          <div className="admin-pulse-cell" data-tone="blue">
            <small>Courses live</small>
            <strong>{kpi.totals.courses.toLocaleString()}</strong>
          </div>
        </div>
      </section>

      {/* ---------- Top-watchers + top courses ---------- */}
      <section className="chart-grid">
        <article className="chart-card">
          <header>
            <span className="chart-eyebrow">Most watched</span>
            <h2>Top courses by watch time</h2>
            <p>Sum of viewed seconds across all enrolled students.</p>
          </header>
          <div className="chart-canvas chart-canvas-mid">
            <TopWatchBar
              items={topCourses.map((c) => ({
                label: c.name,
                seconds: c.watchSeconds,
                sublabel: `${c.completedCount}/${c.totalProgressRows} completed`,
              }))}
              emptyLabel="No watch activity yet"
            />
          </div>
        </article>

        <article className="chart-card">
          <header>
            <span className="chart-eyebrow">Most active learners</span>
            <h2>Top students by watch time</h2>
            <p>Total minutes watched — completions credited at full duration.</p>
          </header>
          <div className="chart-canvas chart-canvas-mid">
            <TopWatchBar
              items={topStudents.map((s) => ({
                label: s.name,
                seconds: s.watchSeconds,
                sublabel: s.email,
              }))}
              emptyLabel="No student activity yet"
            />
          </div>
        </article>
      </section>

      {/* ---------- Completion rate ---------- */}
      <section className="chart-grid">
        <article className="chart-card chart-card-wide">
          <header>
            <span className="chart-eyebrow">Outcomes</span>
            <h2>Course completion rate</h2>
            <p>
              Share of progress rows marked completed per course. Green ≥ 75%, yellow 40-74%, red &lt;
              40%.
            </p>
          </header>
          <div className="chart-canvas chart-canvas-mid">
            <CompletionBar
              items={completion.map((c) => ({
                label: c.name,
                pct: c.completionPct,
                completed: c.completed,
                total: c.total,
              }))}
              emptyLabel="No completion data yet"
            />
          </div>
        </article>
      </section>

      {/* ---------- Operational activity + catalog composition ---------- */}
      <section className="chart-grid">
        <article className="chart-card chart-card-wide">
          <header>
            <span className="chart-eyebrow">Operations · last 30 days</span>
            <h2>Admin activity</h2>
            <p>Audited admin events per day — creates, edits, deletes, and access changes.</p>
          </header>
          <div className="chart-canvas chart-canvas-mid">
            <AuditActivityBar data={auditActivity} />
          </div>
        </article>

        <article className="chart-card">
          <header>
            <span className="chart-eyebrow">Catalog mix</span>
            <h2>Content composition</h2>
            <p>How the catalog breaks down across entities.</p>
          </header>
          <div className="chart-canvas chart-canvas-mid">
            <CatalogDonut
              segments={[
                { label: "Courses", value: kpi.totals.courses },
                { label: "Modules", value: kpi.totals.modules },
                { label: "Videos", value: kpi.totals.videos },
                { label: "Notes", value: kpi.totals.notes },
                { label: "Batches", value: kpi.totals.batches },
              ]}
            />
          </div>
        </article>
      </section>

    </div>
  );
}

// ---------- presentational helpers ----------

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint?: string;
  tone: "green" | "dark" | "cyan" | "purple" | "orange";
}) {
  return (
    <article className="kpi-card" data-tone={tone}>
      <span className="kpi-card-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div>
        <span className="kpi-card-label">{label}</span>
        <strong className="kpi-card-value">{value}</strong>
        {hint ? <span className="kpi-card-hint">{hint}</span> : null}
      </div>
    </article>
  );
}

function CatalogStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof GraduationCap;
  label: string;
  value: number;
  tone: "blue" | "cyan" | "purple" | "green" | "orange" | "rose" | "slate" | "dark";
}) {
  return (
    <article className="catalog-cell" data-tone={tone}>
      <span className="catalog-cell-icon" aria-hidden="true">
        <Icon size={17} />
      </span>
      <div>
        <span className="catalog-cell-label">{label}</span>
        <strong className="catalog-cell-value">{value.toLocaleString()}</strong>
      </div>
    </article>
  );
}

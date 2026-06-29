export default function DashboardLoading() {
  return (
    <div className="sx-loading" role="status" aria-live="polite">
      <div className="sx-loading-card">
        <span className="sx-loading-mark" aria-hidden="true">
          S
        </span>
        <strong className="sx-loading-title">SkillSpark</strong>
        <span className="sx-loading-sub">Preparing your dashboard…</span>
        <span className="sx-loading-bar" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}

import Link from "next/link";
import { Home, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth";
import { isGeminiConfigured } from "@/lib/gemini";
import StudentChatWidget from "@/components/StudentChatWidget";

type Props = {
  accessUntil?: string;
};

export default function StudentTopbar({ accessUntil }: Props) {
  const chatEnabled = isGeminiConfigured();
  return (
    <>
      <header className="sx-topbar">
        <div className="sx-topbar-in">
          <Link href="/dashboard" className="sx-brand">
            <span className="sx-brand-mark" aria-hidden="true">
              S
            </span>
            <span className="sx-brand-text">
              <strong>SkillSpark</strong>
              <span>Recorded videos</span>
            </span>
          </Link>
          {/* On mobile the logo is dropped and this takes its place on the left,
              so students always have a clear way back to the dashboard. */}
          <Link
            href="/dashboard"
            className="sx-btn sx-btn--ghost sx-home sx-home--mobile"
          >
            <Home size={16} aria-hidden="true" />
            Home
          </Link>
          <div className="sx-topbar-right">
            <Link href="/dashboard" className="sx-btn sx-btn--ghost sx-home sx-home--desktop">
              <Home size={15} aria-hidden="true" />
              Home
            </Link>
            {accessUntil ? (
              <span className="sx-access-chip">Access until {accessUntil}</span>
            ) : null}
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="sx-btn sx-btn--ghost sx-signout" type="submit">
                <LogOut size={15} aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <StudentChatWidget enabled={chatEnabled} />
    </>
  );
}

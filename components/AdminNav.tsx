"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Layers3,
  LayoutDashboard,
  Search,
  ScrollText,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/admin", label: "Home", icon: LayoutDashboard },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/admin/batches", label: "Batches", icon: Layers3 },
  { href: "/admin/courses", label: "Courses", icon: BookOpen },
  { href: "/admin/search", label: "Search", icon: Search },
  { href: "/admin/bulk", label: "Bulk", icon: Upload },
  { href: "/admin/audit-logs", label: "Audit logs", icon: ScrollText },
  { href: "/admin/ai-assistant", label: "AI assistant", icon: Sparkles },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={true}
            onMouseEnter={() => {
              router.prefetch(item.href);
            }}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={18} strokeWidth={2.1} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/northai", label: "Estúdio" },
  { href: "/admin/northai/automacoes", label: "Automações" },
];

export default function NorthAiTabs() {
  const pathname = usePathname();
  return (
    <nav className="clients-section-tabs nai-tabs" aria-label="Telas do NorthAi">
      {TABS.map((tab) => {
        const on = tab.href === "/admin/northai" ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import type { AdminHomeSummary } from "@/lib/supabase";

// Weekly grid behind the "Ver calendário" toggle on the Home. Deliberately not
// the Kanban's month calendar: this is the same seven days the list above
// covers, just laid out so gaps and pile-ups are visible at a glance.

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function WeekCalendar({ items }: { items: AdminHomeSummary["weekAhead"] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = startOfWeek(today);
  const todayIso = iso(today);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    const key = iso(d);
    return { key, date: d, isToday: key === todayIso, tasks: items.filter((t) => t.dueDate === key) };
  });

  return (
    <div className="week-cal" role="grid" aria-label="Prazos da semana">
      {days.map((d) => (
        <div className={`week-cal-day${d.isToday ? " is-today" : ""}`} key={d.key} role="gridcell">
          <div className="week-cal-head">
            <span className="week-cal-dow">{DOW[d.date.getDay()]}</span>
            <strong className="week-cal-num">{String(d.date.getDate()).padStart(2, "0")}</strong>
          </div>
          <div className="week-cal-items">
            {d.tasks.length === 0 ? (
              <span className="week-cal-empty" aria-hidden="true">
                —
              </span>
            ) : (
              d.tasks.map((t) => (
                <Link className="week-cal-pill" href="/admin/operacao" key={t.id} title={`${t.title} · ${t.clientName}`}>
                  <strong>{t.title}</strong>
                  <span>{t.clientName}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

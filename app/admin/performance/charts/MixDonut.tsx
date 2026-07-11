"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtCompact, type MixSlice } from "../insights";
import { tooltipStyle, useChartTheme } from "./chartTheme";

// Engagement-mix donut. Fixed slot order (curtidas→teal, comentários→blue,
// compartilhamentos→gold, salvos→purple) with a labeled legend beside it —
// identity is never carried by color alone.
export default function MixDonut({ slices }: { slices: MixSlice[] }) {
  const t = useChartTheme();
  const SLOT: Record<MixSlice["key"], number> = { likes: 0, comentarios: 1, compartilhamentos: 2, salvos: 3 };
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  return (
    <div className="perf-donut">
      <div className="perf-donut-chart">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Tooltip contentStyle={tooltipStyle(t)} formatter={(value, name) => [fmtCompact(Number(value)), String(name)]} />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="90%"
              paddingAngle={2}
              stroke={t.surface}
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={t.series[SLOT[s.key]]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="perf-donut-center">
          <strong>{fmtCompact(total)}</strong>
          <span>interações</span>
        </div>
      </div>
      <ul className="perf-donut-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="perf-legend-dot" style={{ background: t.series[SLOT[s.key]] }} />
            <span className="perf-legend-label">{s.label}</span>
            <b>{fmtCompact(s.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

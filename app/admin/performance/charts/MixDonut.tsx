"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtCompact, type MixSlice } from "../insights";
import { tooltipStyle, useChartTheme } from "./chartTheme";

// Engagement-mix donut. Slot/color is positional now (slices are whatever 4
// metrics — built-in or custom — the user configured), not keyed by a fixed
// metric union; a labeled legend beside it still carries identity, color
// alone is just a visual accent.
export default function MixDonut({ slices }: { slices: MixSlice[] }) {
  const t = useChartTheme();
  const slot = (key: MixSlice["key"]) => Math.max(0, slices.findIndex((s) => s.key === key));
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
                <Cell key={s.key} fill={t.series[slot(s.key)]} />
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
            <span className="perf-legend-dot" style={{ background: t.series[slot(s.key)] }} />
            <span className="perf-legend-label">{s.label}</span>
            <b>{fmtCompact(s.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

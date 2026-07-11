"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCompact } from "../insights";
import { tooltipStyle, useChartTheme } from "./chartTheme";
import type { MetaPost } from "@/lib/windsor";

// Horizontal top-posts comparison on the active metric. Instagram bars take
// series slot 4 (purple) and Facebook slot 2 (blue) — same platform tones the
// ranking table chips use, so color carries the same meaning everywhere.
export default function PostsBarChart({
  posts,
  metric,
  label,
}: {
  posts: MetaPost[];
  metric: string;
  label: string;
}) {
  const t = useChartTheme();
  const data = posts.map((p) => ({
    name: p.caption ? (p.caption.length > 28 ? `${p.caption.slice(0, 28)}…` : p.caption) : p.id,
    value: (p.metrics as Record<string, number | undefined>)[metric] ?? 0,
    platform: p.platform,
  }));
  const height = Math.max(180, data.length * 34 + 24);
  return (
    <div className="perf-chart-body">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={170}
            tick={{ fill: t.sec, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle(t)}
            formatter={(value) => [fmtCompact(Number(value)), label]}
            cursor={{ fill: t.grid, opacity: 0.35 }}
          />
          <Bar dataKey="value" barSize={18} radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.platform === "instagram" ? t.series[3] : t.series[1]} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: React.ReactNode) => fmtCompact(Number(v))}
              style={{ fill: t.ink, fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCompact } from "../insights";
import { tooltipStyle, useChartTheme } from "./chartTheme";
import type { MetaPlatform } from "@/lib/windsor";

type BarPost = {
  id?: string;
  key?: string;
  caption: string;
  platform: MetaPlatform;
  value: number;
};

// Horizontal top-posts comparison on the active metric. Instagram bars take
// series slot 4 (purple) and Facebook slot 2 (blue) — same platform tones the
// ranking table chips use, so color carries the same meaning everywhere.
// `value` arrives pre-resolved (campaignMetricValue in insights.ts) so this
// chart never needs to know whether the active metric is built-in or custom.
export default function PostsBarChart({
  posts,
  label,
  formatValue = fmtCompact,
}: {
  posts: BarPost[];
  label: string;
  formatValue?: (value: number) => string;
}) {
  const t = useChartTheme();
  const data = posts.map((p) => ({
    name: p.caption ? (p.caption.length > 28 ? `${p.caption.slice(0, 28)}…` : p.caption) : p.id,
    value: p.value,
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
            formatter={(value) => [formatValue(Number(value)), label]}
            cursor={{ fill: t.grid, opacity: 0.35 }}
          />
          <Bar dataKey="value" barSize={18} radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.platform === "instagram" ? t.series[3] : t.series[1]} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: React.ReactNode) => formatValue(Number(v))}
              style={{ fill: t.ink, fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

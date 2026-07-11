"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCompact } from "../insights";
import { tooltipStyle, useChartTheme } from "./chartTheme";

// Daily trend of one metric: 2px stroke, soft gradient fill, hairline
// horizontal-only grid — the quiet "north star" chart at the top of the
// dashboard.
export default function TrendChart({
  data,
  label,
}: {
  data: { date: string; value: number }[];
  label: string;
}) {
  const t = useChartTheme();
  const fmtDay = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(d)}/${Number(m)}`;
  };
  return (
    <div className="perf-chart-body">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="perfTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={t.series[0]} stopOpacity={0.22} />
              <stop offset="100%" stopColor={t.series[0]} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={t.grid} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDay}
            tick={{ fill: t.muted, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v: number) => fmtCompact(v)}
            tick={{ fill: t.muted, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            contentStyle={tooltipStyle(t)}
            labelFormatter={(iso) => fmtDay(String(iso))}
            formatter={(value) => [fmtCompact(Number(value)), label]}
            cursor={{ stroke: t.muted, strokeDasharray: "4 4" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={t.series[0]}
            strokeWidth={2}
            fill="url(#perfTrendFill)"
            dot={false}
            activeDot={{ r: 4, fill: t.series[0], stroke: t.surface, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

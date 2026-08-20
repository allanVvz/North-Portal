"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCompact } from "../insights";
import { tooltipStyle, useChartTheme } from "./chartTheme";

export type TrendSeriesDefinition = { key: string; label: string; money?: boolean; dash?: string };

const CHART_FONT = 'Inter, "Segoe UI", Arial, sans-serif';

export default function TrendChart({
  data,
  series,
}: {
  data: Array<{ date: string } & Record<string, string | number>>;
  series: TrendSeriesDefinition[];
}) {
  const theme = useChartTheme();
  const hasMoney = series.some((item) => item.money);
  const hasNumber = series.some((item) => !item.money);
  const fmtDay = (iso: string) => {
    const [, month, day] = iso.split("-");
    return `${Number(day)}/${Number(month)}`;
  };
  const fmtMoney = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);

  return (
    <div className="perf-chart-body">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: hasMoney && hasNumber ? 8 : 18, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: theme.muted, fontFamily: CHART_FONT, fontSize: 11.5, fontWeight: 500 }} axisLine={false} tickLine={false} minTickGap={24} />
          {hasNumber ? <YAxis yAxisId="number" tickFormatter={(value: number) => fmtCompact(value)} tick={{ fill: theme.muted, fontFamily: CHART_FONT, fontSize: 11.5, fontWeight: 500 }} axisLine={false} tickLine={false} width={52} /> : null}
          {hasMoney ? <YAxis yAxisId="money" orientation={hasNumber ? "right" : "left"} tickFormatter={fmtMoney} tick={{ fill: theme.muted, fontFamily: CHART_FONT, fontSize: 11.5, fontWeight: 500 }} axisLine={false} tickLine={false} width={72} /> : null}
          <Tooltip
            contentStyle={tooltipStyle(theme)}
            labelFormatter={(iso) => fmtDay(String(iso))}
            formatter={(value, name) => {
              const definition = series.find((item) => item.key === name);
              const numeric = Number(value);
              return [definition?.money ? fmtMoney(numeric) : fmtCompact(numeric), definition?.label ?? String(name)];
            }}
            cursor={{ stroke: theme.muted, strokeDasharray: "4 4" }}
          />
          {series.length > 1 ? <Legend wrapperStyle={{ fontFamily: CHART_FONT, fontSize: 11.5, fontWeight: 650, color: theme.sec, paddingTop: 8 }} formatter={(key) => series.find((item) => item.key === key)?.label ?? key} /> : null}
          {series.map((item, index) => (
            <Line key={item.key} yAxisId={item.money ? "money" : "number"} type="monotone" dataKey={item.key} name={item.key} stroke={theme.series[index % theme.series.length]} strokeDasharray={item.dash} strokeWidth={2.6} strokeLinecap="round" dot={false} activeDot={{ r: 4, fill: theme.series[index % theme.series.length], stroke: theme.surface, strokeWidth: 2 }} isAnimationActive={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

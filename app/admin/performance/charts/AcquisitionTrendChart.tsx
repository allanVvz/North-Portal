"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AcquisitionDay } from "../acquisitionInsights";
import { tooltipStyle, useChartTheme } from "./chartTheme";

const FONT = 'Inter, "Segoe UI", Arial, sans-serif';
const formatDay = (iso: string) => {
  const [, month, day] = iso.split("-");
  return `${Number(day)}/${Number(month)}`;
};

export default function AcquisitionTrendChart({ data }: { data: AcquisitionDay[] }) {
  const theme = useChartTheme();
  return (
    <div className="acq-trend-chart" role="img" aria-label="Evolução do investimento e das mensagens iniciadas">
      <ResponsiveContainer width="100%" height={290}>
        <LineChart data={data} margin={{ top: 12, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={theme.grid} vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fill: theme.muted, fontFamily: FONT, fontSize: 11, fontWeight: 550 }} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis yAxisId="money" tickFormatter={(value: number) => `R$ ${Math.round(value)}`} tick={{ fill: theme.muted, fontFamily: FONT, fontSize: 11, fontWeight: 550 }} tickLine={false} axisLine={false} width={62} />
          <YAxis yAxisId="volume" orientation="right" allowDecimals={false} tick={{ fill: theme.muted, fontFamily: FONT, fontSize: 11, fontWeight: 550 }} tickLine={false} axisLine={false} width={34} />
          <Tooltip
            contentStyle={{ ...tooltipStyle(theme), fontFamily: FONT }}
            labelFormatter={(label) => formatDay(String(label))}
            formatter={(value, name) => name === "spend"
              ? [new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value)), "Investimento"]
              : [new Intl.NumberFormat("pt-BR").format(Number(value)), "Mensagens iniciadas"]}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 650, color: theme.sec, paddingTop: 8 }}
            formatter={(name) => name === "spend" ? "Investimento" : "Mensagens iniciadas"}
          />
          <Line yAxisId="money" type="monotone" dataKey="spend" stroke={theme.series[3]} strokeWidth={2.7} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="volume" type="monotone" dataKey="messages" stroke={theme.series[0]} strokeWidth={2.7} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

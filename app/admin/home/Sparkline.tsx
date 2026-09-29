/** Minigráfico de linha: a tendência sem eixo, com o último ponto marcado. */
export default function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const points = values.map((value, index) => ({ index, value })).filter((point): point is { index: number; value: number } => point.value !== null);
  if (points.length < 2) return <span className="spark-empty" aria-hidden>—</span>;
  const width = 96; const height = 28; const pad = 3;
  const min = Math.min(...points.map((point) => point.value)); const max = Math.max(...points.map((point) => point.value));
  const x = (index: number) => pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2);
  const y = (value: number) => max === min ? height / 2 : height - pad - ((value - min) / (max - min)) * (height - pad * 2);
  const path = points.map((point, at) => `${at ? "L" : "M"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <path d={`${path} L${x(last.index).toFixed(1)},${height} L${x(points[0].index).toFixed(1)},${height} Z`} className="spark-area" />
      <path d={path} className="spark-line" fill="none" />
      <circle cx={x(last.index)} cy={y(last.value)} r="2.4" className="spark-dot" />
    </svg>
  );
}

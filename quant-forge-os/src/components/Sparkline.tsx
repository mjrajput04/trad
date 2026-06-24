type Props = {
  data: number[];
  positive?: boolean;
  width?: number;
  height?: number;
  strokeWidth?: number;
  fill?: boolean;
};

export function Sparkline({ data, positive = true, width = 120, height = 36, strokeWidth = 1.5, fill = true }: Props) {
  if (!data?.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => `${(i * stepX).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`);
  const d = `M ${pts.join(" L ")}`;
  const area = `${d} L ${width},${height} L 0,${height} Z`;
  const color = positive ? "var(--bull)" : "var(--bear)";
  const id = `sg-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

import { COMPASS_VIEWBOX, compassShapes } from "./compass";

// O símbolo da North em React. NÃO tem geometria própria: desenha o que está
// em app/brand/compass.ts, o mesmo arquivo de onde o favicon é gerado — por
// isso o ícone da aba do navegador e o da barra lateral nunca divergem.
//
// A tinta vem de `currentColor`: quem monta decide a cor pelo CSS
// (`.site-compass { color: var(--sage) }`), e a marca se adapta ao contexto
// sem precisar de variante.
export default function CompassMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${COMPASS_VIEWBOX} ${COMPASS_VIEWBOX}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {compassShapes.map((shape, i) => {
        switch (shape.kind) {
          case "ring":
            return (
              <circle
                key={i}
                cx={shape.cx}
                cy={shape.cy}
                r={shape.r}
                fill="none"
                stroke="currentColor"
                strokeWidth={shape.width}
                opacity={shape.opacity}
              />
            );
          case "dot":
            return (
              <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill="currentColor" opacity={shape.opacity} />
            );
          case "spoke":
            return (
              <line
                key={i}
                x1={shape.x1}
                y1={shape.y1}
                x2={shape.x2}
                y2={shape.y2}
                stroke="currentColor"
                strokeWidth={shape.width}
                opacity={shape.opacity}
              />
            );
          case "blade":
            return <path key={i} d={shape.d} fill="currentColor" opacity={shape.opacity} />;
        }
      })}
    </svg>
  );
}

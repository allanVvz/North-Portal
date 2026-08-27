// Marca única da North: rosa dos ventos reconstruída em vetores finos a
// partir da bússola clássica de referência (agulha N-S afiada, aro duplo,
// raios intercardeais, "joia" central) — mesmo SVG em toda a plataforma
// (barra lateral do admin, header/footer do site público, login, favicon),
// monocromática: uma única cor via `currentColor`, toda a profundidade vem
// de opacidade, nunca de matiz.
export default function CompassMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* aros finos, duplo bisel */}
      <circle cx="16" cy="16" r="13.8" stroke="currentColor" strokeWidth="0.6" opacity="0.38" />
      <circle cx="16" cy="16" r="10.6" stroke="currentColor" strokeWidth="0.4" opacity="0.2" />

      {/* raios intercardeais, delicados */}
      <line x1="24.63" y1="7.37" x2="25.76" y2="6.24" stroke="currentColor" strokeWidth="0.7" opacity="0.3" />
      <line x1="24.63" y1="24.63" x2="25.76" y2="25.76" stroke="currentColor" strokeWidth="0.7" opacity="0.3" />
      <line x1="7.37" y1="24.63" x2="6.24" y2="25.76" stroke="currentColor" strokeWidth="0.7" opacity="0.3" />
      <line x1="7.37" y1="7.37" x2="6.24" y2="6.24" stroke="currentColor" strokeWidth="0.7" opacity="0.3" />

      {/* marcas cardeais, no aro */}
      <circle cx="16" cy="2.2" r="0.95" fill="currentColor" opacity="0.6" />
      <circle cx="29.8" cy="16" r="0.95" fill="currentColor" opacity="0.6" />
      <circle cx="16" cy="29.8" r="0.95" fill="currentColor" opacity="0.6" />
      <circle cx="2.2" cy="16" r="0.95" fill="currentColor" opacity="0.6" />

      {/* agulha Leste-Oeste, esguia, ao fundo */}
      <path d="M2 16 L16 15.1 L30 16 Z" fill="currentColor" opacity="0.26" />
      <path d="M2 16 L16 16.9 L30 16 Z" fill="currentColor" opacity="0.42" />

      {/* agulha Norte-Sul, esguia e afiada, em primeiro plano */}
      <path d="M16 2 L14.7 16 L16 30 Z" fill="currentColor" opacity="0.72" />
      <path d="M16 2 L17.3 16 L16 30 Z" fill="currentColor" />

      {/* joia central */}
      <circle cx="16" cy="16" r="2.3" stroke="currentColor" strokeWidth="0.4" opacity="0.5" />
      <circle cx="16" cy="16" r="1.1" fill="currentColor" />
    </svg>
  );
}

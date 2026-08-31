import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O PDF da automação (@react-pdf/renderer) carrega .ttf de lib/reports/fonts/
  // por caminho absoluto em runtime — o tracer do Next não enxerga isso sozinho.
  outputFileTracingIncludes: {
    "/api/admin/automations/run": ["./lib/reports/fonts/*.ttf"],
  },
};

export default nextConfig;

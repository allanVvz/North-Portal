import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // tsconfig tem jsx: "preserve" (Next.js). Vitest 4 transpila com oxc e herda
  // esse "preserve", o que deixa JSX cru nos .tsx que entram no grafo de teste
  // (ex.: lib/reports/adsReportPdf.tsx). Forçar o runtime automático do React.
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  test: {
    environment: "node",
    // e2e/** runs under Playwright (npm run test:e2e), not vitest.
    exclude: ["**/node_modules/**", "e2e/**"],
  },
});

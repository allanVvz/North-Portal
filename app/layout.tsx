import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "North · Portal do Cliente",
  description: "Briefing, materiais e resultados do cliente North.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

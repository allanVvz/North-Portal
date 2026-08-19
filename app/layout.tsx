import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "North · Marketing com direção", template: "%s" },
  description: "Estratégia, conteúdo e performance para negócios locais premium.",
  applicationName: "North",
  keywords: ["marketing para negócios locais", "agência de marketing", "tráfego pago", "estratégia de conteúdo"],
  robots: { index: true, follow: true },
  openGraph: { siteName: "North", locale: "pt_BR", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }

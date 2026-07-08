import "./site.css";
import SiteFrame from "./SiteFrame";

// Public marketing site (landing + planos + como funciona + quem somos + legal).
// Wrapped by the sticky header + rich footer + light/dark theme in SiteFrame.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteFrame>{children}</SiteFrame>;
}

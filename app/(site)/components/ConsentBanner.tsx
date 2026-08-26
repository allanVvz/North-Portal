"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConsent, loadGa, setConsent } from "./analytics";

export default function ConsentBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => setOpen(getConsent() === null);
    sync(); if (getConsent() === "accepted") loadGa();
    window.addEventListener("north:consent", () => setOpen(true));
    window.addEventListener("north:consent-change", sync);
    return () => window.removeEventListener("north:consent-change", sync);
  }, []);
  const choose = (choice: "accepted" | "rejected") => { setConsent(choice); setOpen(false); if (choice === "accepted") loadGa(); };
  if (!open) return null;
  return <aside className="consent" role="dialog" aria-label="Preferências de cookies" aria-live="polite"><div><b>Sua privacidade, com clareza.</b><p>Usamos cookies essenciais para o site funcionar e, com sua permissão, analytics para entender a navegação. Nunca enviamos seus dados de contato ao GA4. <Link href="/politica-de-cookies">Saiba mais</Link>.</p></div><div className="consent-actions"><button className="site-btn ghost" onClick={() => choose("rejected")}>Somente essenciais</button><button className="site-btn solid" onClick={() => choose("accepted")}>Aceitar analytics</button></div></aside>;
}

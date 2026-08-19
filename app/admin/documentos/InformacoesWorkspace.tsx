"use client";

import { useState } from "react";
import DocumentsTable from "./DocumentsTable";
import OnboardingTable from "../onboarding/OnboardingTable";
import type { AdminBriefingRow, AdminDocument } from "@/lib/supabase";
import { isHtmlDocument } from "@/lib/documentFiles";

type ClientLite = { slug: string; name: string };
type Section = "documentos" | "trilhas" | "onboarding";

export default function InformacoesWorkspace({
  documents,
  clients,
  briefings,
}: {
  documents: AdminDocument[];
  clients: ClientLite[];
  briefings: AdminBriefingRow[];
}) {
  const [section, setSection] = useState<Section>("documentos");
  const docCount = documents.filter((d) => !isHtmlDocument(d)).length;
  const trilhasCount = documents.filter(isHtmlDocument).length;

  return (
    <>
      <nav className="clients-section-tabs" aria-label="Seções de informações">
        <button type="button" className={section === "documentos" ? "on" : ""} onClick={() => setSection("documentos")}>Documentos <span>{docCount}</span></button>
        <button type="button" className={section === "trilhas" ? "on" : ""} onClick={() => setSection("trilhas")}>Trilhas North <span>{trilhasCount}</span></button>
        <button type="button" className={section === "onboarding" ? "on" : ""} onClick={() => setSection("onboarding")}>Onboarding <span>{briefings.length}</span></button>
      </nav>

      {section === "documentos" ? (
        <DocumentsTable initial={documents} clients={clients} variant="documentos" />
      ) : null}

      {section === "trilhas" ? (
        <DocumentsTable initial={documents} clients={clients} variant="trilhas" />
      ) : null}

      {section === "onboarding" ? (
        <div className="info-section-centered info-onboarding-wide">
          <div className="info-panel">
            <div className="info-section-head">
              <p className="info-eyebrow">Onboarding</p>
              <h2>Etapas por cliente</h2>
            </div>
            <OnboardingTable rows={briefings} />
          </div>
        </div>
      ) : null}
    </>
  );
}

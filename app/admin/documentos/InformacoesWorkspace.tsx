"use client";

import { useState } from "react";
import DocumentsTable from "./DocumentsTable";
import NorthTrilhasManager from "./NorthTrilhasManager";
import OnboardingTable from "../onboarding/OnboardingTable";
import ClientPipelineBoard from "../ClientPipelineBoard";
import type { ClientRow } from "../ClientsTable";
import type { AdminBriefingRow, AdminDocument } from "@/lib/supabase";
import type { NorthTrilha } from "@/lib/validation";

type ClientLite = { slug: string; name: string };
type Section = "documentos" | "trilhas" | "onboarding";

export default function InformacoesWorkspace({
  documents,
  trilhas,
  clients,
  briefings,
  clientRows,
}: {
  documents: AdminDocument[];
  trilhas: NorthTrilha[];
  clients: ClientLite[];
  briefings: AdminBriefingRow[];
  clientRows: ClientRow[];
}) {
  const [section, setSection] = useState<Section>("documentos");
  const docCount = documents.length;
  const trilhasCount = trilhas.length;

  return (
    <>
      <nav className="clients-section-tabs" aria-label="Seções de informações">
        <button type="button" className={section === "documentos" ? "on" : ""} onClick={() => setSection("documentos")}>Documentos <span>{docCount}</span></button>
        <button type="button" className={section === "trilhas" ? "on" : ""} onClick={() => setSection("trilhas")}>Trilhas North <span>{trilhasCount}</span></button>
        <button type="button" className={section === "onboarding" ? "on" : ""} onClick={() => setSection("onboarding")}>Onboarding <span>{briefings.length}</span></button>
      </nav>

      <div className="info-content">
        {section === "documentos" ? (
          <DocumentsTable initial={documents} clients={clients} />
        ) : null}

        {section === "trilhas" ? (
          <NorthTrilhasManager initial={trilhas} />
        ) : null}

        {section === "onboarding" ? (
          <div className="info-section-centered info-onboarding-wide">
            <div className="info-panel info-onboarding-panel">
              <div className="info-section-head">
                <p className="info-eyebrow">Onboarding</p>
                <h2>Pipeline de clientes</h2>
              </div>
              <ClientPipelineBoard clients={clientRows} />

              <div className="info-section-head info-onboarding-etapas-head">
                <h2>Etapas por cliente</h2>
              </div>
              <OnboardingTable rows={briefings} />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

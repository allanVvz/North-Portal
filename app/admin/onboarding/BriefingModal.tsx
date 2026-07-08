"use client";

import { briefSteps } from "@/app/[slug]/content";
import type { AdminBriefingRow } from "@/lib/supabase";

function answerFor(client: AdminBriefingRow, key: string): string {
  const v = client.answers[key];
  return typeof v === "string" ? v : "";
}

function csvCell(v: string): string {
  const needsQuotes = /["\n,]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function toCSV(client: AdminBriefingRow): string {
  const rows: string[][] = [["Etapa", "Card", "Pergunta", "Resposta"]];
  for (const step of briefSteps) {
    for (const card of step.cards) {
      card.questions.forEach((q, i) => {
        rows.push([step.eyebrow, card.title, q, answerFor(client, `${card.key}_q${i + 1}`)]);
      });
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export default function BriefingModal({ client, onClose }: { client: AdminBriefingRow; onClose: () => void }) {
  function exportCsv() {
    const csv = `﻿${toCSV(client)}`; // BOM so accented chars open right in Excel
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `briefing-${client.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="briefing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head tm-head-plain">
          <div>
            <h2>Briefing · {client.name}</h2>
            <p className="admin-sub">
              {client.submitted ? "Enviado pelo cliente" : "Ainda não enviado"}
              {client.updatedAt ? ` · atualizado em ${new Date(client.updatedAt).toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="briefing-modal-body">
          {briefSteps.map((step) => (
            <div className="briefing-step" key={step.eyebrow}>
              <p className="briefing-step-eyebrow">{step.eyebrow}</p>
              {step.cards.map((card) => (
                <div className="briefing-card" key={card.key}>
                  <p className="briefing-card-title">{card.title}</p>
                  {card.questions.map((q, i) => {
                    const key = `${card.key}_q${i + 1}`;
                    const answer = answerFor(client, key);
                    return (
                      <div className="briefing-qa" key={key}>
                        <p className="briefing-q">{q}</p>
                        <p className="briefing-a">{answer || <em>Sem resposta</em>}</p>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="briefing-modal-foot">
          <button className="admin-btn primary" onClick={exportCsv}>⬇ Exportar CSV</button>
        </div>
      </div>
    </div>
  );
}

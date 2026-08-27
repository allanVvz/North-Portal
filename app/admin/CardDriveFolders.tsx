"use client";

import { useEffect, useState } from "react";
import type { TaskDriveFolder } from "@/lib/taskCover";
import DriveBrowser from "./DriveBrowser";

// As pastas do Drive de um card, já resolvidas.
//
// Nem todo link citado num card se declara: `/open?id=…` serve para arquivo e
// para pasta, e é a forma mais comum nos comentários reais. Este componente é
// quem tira a dúvida — pergunta ao servidor (/api/admin/drive/kind) e abre o
// navegador só para o que for pasta de fato.
//
// O link que já se prova pasta pela URL (`/drive/folders/…`) não gasta
// requisição nenhuma: entra direto.
export default function CardDriveFolders({ folders }: { folders: TaskDriveFolder[] }) {
  // id -> é pasta? `undefined` enquanto não se sabe.
  const [resolved, setResolved] = useState<Record<string, boolean>>({});

  const pending = folders.filter((f) => !f.certain).map((f) => f.folderId);
  const pendingKey = pending.join(",");

  useEffect(() => {
    if (!pendingKey) return;
    let alive = true;
    void (async () => {
      const answers = await Promise.all(
        pendingKey.split(",").map(async (id) => {
          try {
            const res = await fetch(`/api/admin/drive/kind?id=${encodeURIComponent(id)}`);
            if (!res.ok) return [id, false] as const;
            const data = (await res.json()) as { kind?: string };
            return [id, data.kind === "folder"] as const;
          } catch {
            return [id, false] as const;
          }
        }),
      );
      if (alive) setResolved((prev) => ({ ...prev, ...Object.fromEntries(answers) }));
    })();
    return () => {
      alive = false;
    };
  }, [pendingKey]);

  const visible = folders.filter((f) => f.certain || resolved[f.folderId]);
  const [picked, setPicked] = useState(0);

  // Sem caixa própria: quem monta a moldura é o bloco "Materiais" do modal,
  // que junta a pasta e os anexos numa composição só. Antes isto era uma caixa
  // solta na coluna de comentários, o que dividia "onde estão os arquivos deste
  // card" em dois lugares distantes.
  if (!visible.length) return null;

  // UMA pasta por vez, com seletor quando há mais de uma.
  //
  // Empilhar todas foi a primeira versão e quebrou a coluna: .tm-side é um
  // flex column onde só a caixa de comentários encolhe, então cada navegador a
  // mais empurrava a conversa para fora do modal. O card "REELS FEED - Motivo
  // do estresse" tem três links e transbordava.
  //
  // Além de não quebrar, ler melhor: ninguém circula por três pastas ao mesmo
  // tempo.
  const current = visible[Math.min(picked, visible.length - 1)];

  return (
    <div className="tm-folders">
      {visible.length > 1 ? (
        <div className="drive-pick" role="tablist" aria-label="Pastas citadas no card">
          {visible.map((folder, i) => (
            <button
              type="button"
              key={folder.folderId}
              role="tab"
              aria-selected={i === picked}
              className={`drive-pick-tab${i === picked ? " on" : ""}`}
              onClick={() => setPicked(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      ) : null}
      <DriveBrowser key={current.folderId} folderId={current.folderId} label="Pasta" limit={12} />
    </div>
  );
}

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
  if (!visible.length) return null;

  return (
    <div className="tm-box tm-drivebox">
      <p className="tm-box-label">{visible.length === 1 ? "Pasta do Drive" : "Pastas do Drive"}</p>
      {visible.map((folder, i) => (
        <DriveBrowser
          key={folder.folderId}
          folderId={folder.folderId}
          label={visible.length === 1 ? "Pasta" : `Pasta ${i + 1}`}
          limit={12}
        />
      ))}
    </div>
  );
}

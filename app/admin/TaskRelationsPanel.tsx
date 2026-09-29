"use client";

import CardParentBox from "./CardParentBox";
import type { TaskRecord } from "@/lib/validation";
import type { ParentBoxItem } from "./CardParentBox";

export default function TaskRelationsPanel({
  parents, references, canOpen, busy, loading, onOpen,
}: {
  parents: ParentBoxItem[];
  references: ParentBoxItem[];
  canOpen: boolean;
  busy: boolean;
  loading: boolean;
  onOpen: (task: TaskRecord) => void;
}) {
  return <section className="task-relations-panel" aria-label="Relações do card">
    <CardParentBox label="Pertence a" items={parents} canOpen={canOpen && !busy} onOpen={onOpen} />
    <CardParentBox label="Veja também" items={references} canOpen={canOpen && !busy} onOpen={onOpen} />
    {loading ? <div className="tm-box tm-parentbox"><p className="tm-box-label">Pertence a</p><p className="admin-sub" style={{ margin: 0 }}>Carregando relação…</p></div> : null}
  </section>;
}

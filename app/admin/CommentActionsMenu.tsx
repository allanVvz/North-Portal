"use client";

import { useState } from "react";
import { FloatingPanel, useDismissOnOutside, useFloatingPopover } from "./FloatingPopover";

export default function CommentActionsMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const { anchorRef, popoverRef, style } = useFloatingPopover(open, "end");
  useDismissOnOutside(open, () => setOpen(false), [anchorRef, popoverRef]);

  return (
    <div className="tm-comment-actions" ref={anchorRef}>
      <button type="button" className="tm-comment-actions-trigger" aria-label="Ações do comentário" aria-expanded={open} aria-haspopup="menu" title="Ações do comentário" onClick={() => setOpen((value) => !value)}>
        <svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8.5" r="1.5" /><circle cx="8.5" cy="8.5" r="1.5" /><circle cx="14" cy="8.5" r="1.5" /></svg>
      </button>
      <FloatingPanel open={open} popoverRef={popoverRef} style={style} className="tm-comment-actions-panel">
        <div role="menu" aria-label="Ações do comentário">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}><span aria-hidden="true">✎</span> Editar</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onDelete(); }}><span aria-hidden="true">×</span> Excluir</button>
        </div>
      </FloatingPanel>
    </div>
  );
}

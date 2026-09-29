"use client";

import { useEffect, useState, type ReactNode } from "react";
import MentionTextarea from "./MentionTextarea";

export default function TaskCommentComposer({
  value, onChange, onSubmit, placeholder, targetLabel, targetKey, contextError, onRefreshContext, sendLabel = "Enviar", disabled = false, tone = "green", leading,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  targetLabel?: ReactNode;
  targetKey: string;
  contextError?: string | null;
  onRefreshContext?: () => Promise<string | void>;
  sendLabel?: string;
  disabled?: boolean;
  tone?: string;
  leading?: ReactNode;
}) {
  const [draftTargetKey, setDraftTargetKey] = useState(targetKey);
  const [acknowledgedContextError, setAcknowledgedContextError] = useState(false);
  useEffect(() => { if (!value.trim()) setDraftTargetKey(targetKey); }, [targetKey, value]);
  useEffect(() => { setAcknowledgedContextError(false); }, [contextError]);
  const externalStale = Boolean(contextError && !acknowledgedContextError);
  const staleTarget = Boolean(value.trim() && (draftTargetKey !== targetKey || externalStale));
  async function updateTarget() {
    if (contextError) {
      if (!onRefreshContext) return;
      const resolvedKey = await onRefreshContext().catch(() => undefined);
      if (!resolvedKey) return;
      setDraftTargetKey(resolvedKey);
      setAcknowledgedContextError(true);
      return;
    }
    setDraftTargetKey(targetKey);
  }
  function changeValue(next: string) {
    if (!value.trim() && next.trim()) setDraftTargetKey(targetKey);
    onChange(next);
  }
  return <div className="tm-comment-input">
    {targetLabel ? <span className="tm-comment-destination" aria-live="polite">{targetLabel}</span> : null}
    {staleTarget ? <div className="tm-comment-context-warning" role="alert">
      <span>{contextError || "O destino mudou. Seu rascunho foi preservado; atualize o destino antes de enviar."}</span>
      <button type="button" className="admin-btn ghost" onClick={() => void updateTarget()}>Atualizar destino</button>
    </div> : null}
    {leading}
    <MentionTextarea value={value} onChange={changeValue} onSubmit={() => { if (!staleTarget) onSubmit(); }} placeholder={placeholder} disabled={disabled} />
    <button type="button" className={`admin-btn primary tm-btn-${tone}`} onClick={onSubmit} disabled={disabled || staleTarget || !value.trim()}>{sendLabel}</button>
  </div>;
}

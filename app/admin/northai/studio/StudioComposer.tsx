"use client";

import { useEffect, useRef } from "react";
import { RECIPE_META, RECIPE_ORDER } from "./meta";
import type { RecipeKey } from "@/lib/northai/commandParser";

// A caixa fixa no pé da conversa. Texto só preenche um pedido — criar exige
// revisar e confirmar no balão.
export default function StudioComposer({
  value,
  onChange,
  onSend,
  onPick,
  showSuggestions,
  clientName,
  disabled,
  onOpenHistory,
  onOpenContext,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onPick: (recipe: RecipeKey) => void;
  showSuggestions: boolean;
  clientName: string | null;
  disabled: boolean;
  onOpenHistory: () => void;
  onOpenContext: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <div className="nai-composer-wrap">
      {showSuggestions ? (
        <div className="nai-suggestions" role="group" aria-label="Pedidos rápidos">
          {RECIPE_ORDER.map((key) => (
            <button type="button" key={key} className="kb-chip" onClick={() => onPick(key)} disabled={disabled}>{RECIPE_META[key].title}</button>
          ))}
        </div>
      ) : null}
      <form className="nai-composer" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
        <button type="button" className="nai-icon-btn" onClick={onOpenHistory} aria-label="Conversas recentes" title="Conversas recentes">☰</button>
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }}
          placeholder={clientName ? `Peça algo para ${clientName} — ex.: 3 reels e 1 carrossel, gravação 22/09` : "Escolha o cliente acima para começar"}
          aria-label="Mensagem para o NorthAi"
        />
        <button type="button" className="nai-icon-btn nai-context-toggle" onClick={onOpenContext} aria-label="Contexto do cliente" title="Contexto do cliente">ⓘ</button>
        <button type="submit" className="nai-send" disabled={disabled || !value.trim()} aria-label="Enviar">↑</button>
      </form>
      <p className="nai-composer-foot">Enter envia · Shift+Enter quebra linha · nada é criado sem a sua confirmação</p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RecipeKey } from "@/lib/northai/commandParser";
import { filterClients, findMentionQuery, pickerKey, removeMentionQuery, type ComposerMention, type MentionQuery } from "@/lib/northai/mentions";
import ClientMentionPicker from "./ClientMentionPicker";
import { ClientMonogram } from "./ClientIdentity";
import { RECIPE_META, RECIPE_ORDER } from "./meta";
import type { ClientLite } from "./types";

// O ponto de entrada do NorthAi: texto + @cliente (a primeira capacidade
// estruturada; "/operação" e "+arquivo" entram no mesmo pacote depois).
// Digitar "@" abre o picker ACIMA da caixa; escolher vira um token com o id do
// cliente. Texto nunca cria nada — só vira pedido para revisar.

export default function StudioComposer({
  clients,
  text,
  mention,
  onText,
  onMention,
  onSend,
  onPick,
  showSuggestions,
  placeholderClient,
  disabled,
  onOpenHistory,
  onOpenContext,
}: {
  clients: readonly ClientLite[];
  text: string;
  mention: ComposerMention | null;
  onText: (text: string) => void;
  onMention: (mention: ComposerMention | null) => void;
  onSend: () => void;
  onPick: (recipe: RecipeKey) => void;
  showSuggestions: boolean;
  placeholderClient: string | null;
  disabled: boolean;
  onOpenHistory: () => void;
  onOpenContext: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [picker, setPicker] = useState({ open: false, index: 0 });
  const options = useMemo(() => (query ? filterClients(clients, query.query, 7) : []), [clients, query]);
  const mentionClient = mention ? clients.find((client) => client.id === mention.clientId) ?? null : null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  function syncQuery(value: string, caret: number) {
    const next = findMentionQuery(value, caret);
    setQuery(next);
    setPicker((current) => ({ open: Boolean(next), index: next && current.open ? current.index : 0 }));
  }

  function choose(client: ClientLite) {
    if (!query) return;
    const { text: cleaned, caret } = removeMentionQuery(text, query);
    onMention({ kind: "client", clientId: client.id, label: client.name });
    onText(cleaned);
    setQuery(null);
    setPicker({ open: false, index: 0 });
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.key === "Enter" && event.shiftKey)) {
      const step = pickerKey(picker, event.key, options.length);
      if (step.handled) {
        event.preventDefault();
        setPicker(step.state);
        if (step.select !== null && options[step.select]) choose(options[step.select]);
        else if (!step.state.open) setQuery(null);
        return;
      }
    }
    if (event.key === "Backspace" && mention && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
      event.preventDefault();
      onMention(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  const listId = "nai-mention-list";
  const activeOption = picker.open && options[picker.index] ? `${listId}-${options[picker.index].id}` : undefined;

  return (
    <div className="nai-composer-wrap">
      {showSuggestions ? (
        <div className="nai-suggestions" role="group" aria-label="Pedidos rápidos">
          {RECIPE_ORDER.map((key) => (
            <button type="button" key={key} className="nai-suggestion" onClick={() => onPick(key)} disabled={disabled}>{RECIPE_META[key].title}</button>
          ))}
        </div>
      ) : null}
      <form className="nai-composer" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
        {picker.open ? (
          <ClientMentionPicker
            id={listId}
            clients={options}
            activeIndex={picker.index}
            placement="up"
            onPick={choose}
            onHover={(index) => setPicker({ open: true, index })}
          />
        ) : null}
        <div className="nai-composer-field">
          {mentionClient ? (
            <span className="nai-token" title={`Pedido para ${mentionClient.name}`}>
              <ClientMonogram client={mentionClient} size="xs" />
              @{mentionClient.name}
              <button type="button" aria-label={`Remover ${mentionClient.name}`} onClick={() => { onMention(null); ref.current?.focus(); }}>✕</button>
            </span>
          ) : null}
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            role="combobox"
            aria-expanded={picker.open}
            aria-controls={picker.open ? listId : undefined}
            aria-activedescendant={activeOption}
            aria-autocomplete="list"
            aria-label="Mensagem para o NorthAi"
            onChange={(event) => { onText(event.target.value); syncQuery(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
            onSelect={(event) => syncQuery(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
            onBlur={() => setPicker({ open: false, index: 0 })}
            onKeyDown={onKeyDown}
            placeholder={placeholderClient ? `Peça algo para ${placeholderClient}…` : "Peça algo para a North… use @ para escolher o cliente"}
          />
        </div>
        <div className="nai-composer-bar">
          <button type="button" className="nai-icon-btn" onClick={onOpenHistory} aria-label="Conversas recentes" title="Conversas recentes">☰</button>
          <button
            type="button"
            className="nai-icon-btn nai-at-btn"
            aria-label="Mencionar cliente"
            title="Mencionar cliente (@)"
            disabled={disabled}
            onClick={() => {
              const el = ref.current;
              const caret = el?.selectionStart ?? text.length;
              const before = text.slice(0, caret);
              const insert = before && !/\s$/.test(before) ? " @" : "@";
              const next = `${before}${insert}${text.slice(caret)}`;
              onText(next);
              const nextCaret = caret + insert.length;
              syncQuery(next, nextCaret);
              requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(nextCaret, nextCaret); });
            }}
          >
            @
          </button>
          <span className="nai-composer-hint">Enter envia · Shift+Enter quebra linha · nada é criado sem confirmação</span>
          <button type="button" className="nai-icon-btn nai-context-toggle" onClick={onOpenContext} aria-label="Contexto do cliente" title="Contexto do cliente">ⓘ</button>
          <button type="submit" className="nai-send" disabled={disabled || !text.trim()} aria-label="Enviar">↑</button>
        </div>
      </form>
    </div>
  );
}

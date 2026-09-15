"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizeSearchText } from "@/lib/taskSearch";

// Campo de comentário com @menção (ATA 14/09).
//
// Digitar "@" abre a lista da equipe; escolher alguém escreve "@Nome " no
// texto. A menção é só texto — o servidor reconhece o nome ao gravar
// (app/api/admin/tasks/[id]/comments), avisa a pessoa e a Home dela passa a
// listar o card em "Aguardando sua resposta" até ela comentar de volta. Não há
// coluna nova: o comentário continua sendo `{author, text, at}`.

export type TeamMember = { id: string; name: string };

// Uma busca por sessão de página: a equipe é pequena e muda raramente, e todo
// campo de comentário aberto pede a mesma lista.
let membersPromise: Promise<TeamMember[]> | null = null;
function loadTeamMembers(): Promise<TeamMember[]> {
  membersPromise ??= fetch("/api/admin/team/members")
    .then((res) => (res.ok ? res.json() : { members: [] }))
    .then((data: { members?: TeamMember[] }) => data.members ?? [])
    .catch(() => {
      membersPromise = null;
      return [];
    });
  return membersPromise;
}

// "@" no início ou depois de espaço, seguido do que já foi digitado do nome
// (até duas palavras, para "Ana Paula").
const TOKEN_BEFORE_CARET = /(^|\s)@([\p{L}\p{N}._-]*(?: [\p{L}\p{N}._-]*)?)$/u;

export default function MentionTextarea({
  value,
  onChange,
  onSubmit,
  placeholder,
  className,
  rows = 1,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Enter sem Shift. Omitido: Enter só quebra a linha. */
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [token, setToken] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadTeamMembers().then((list) => { if (!cancelled) setMembers(list); });
    return () => { cancelled = true; };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const matches = useMemo(() => {
    if (!token) return [];
    const needle = normalizeSearchText(token.text);
    return members.filter((member) => normalizeSearchText(member.name).includes(needle)).slice(0, 6);
  }, [members, token]);

  function detect(text: string, caret: number) {
    const found = TOKEN_BEFORE_CARET.exec(text.slice(0, caret));
    if (!found) { setToken(null); return; }
    setToken({ start: caret - found[2].length - 1, text: found[2] });
    setActive(0);
  }

  function pick(member: TeamMember) {
    const el = ref.current;
    if (!el || !token) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, token.start)}@${member.name} ${value.slice(caret)}`;
    const position = token.start + member.name.length + 2;
    onChange(next);
    setToken(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(position, position);
    });
  }

  return (
    <div className="mention-wrap">
      <textarea
        ref={ref}
        className={className}
        rows={rows}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
          detect(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onKeyDown={(event) => {
          if (matches.length) {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => (i + 1) % matches.length); return; }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); return; }
            if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(matches[active]); return; }
            // Esc fecha a lista, não o card: sem o stopPropagation o atalho do
            // modal (Esc = fechar) levaria o comentário em andamento junto.
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setToken(null); return; }
          }
          if (event.key === "Enter" && !event.shiftKey && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onBlur={() => setTimeout(() => setToken(null), 150)}
      />
      {matches.length ? (
        <div className="mention-pop" role="listbox" aria-label="Mencionar alguém da equipe">
          {matches.map((member, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              key={member.id}
              className={`mention-opt ${index === active ? "on" : ""}`}
              onMouseDown={(event) => { event.preventDefault(); pick(member); }}
            >
              <span className="mention-opt-at" aria-hidden>@</span>{member.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

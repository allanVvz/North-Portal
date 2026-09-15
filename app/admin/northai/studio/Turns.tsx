"use client";

import NorthAiAvatar from "./NorthAiAvatar";
import { STATUS_LABEL, type RecipeStatus, type StudioMessage } from "./types";

// Turnos da conversa. Mensagens seguidas do NorthAi formam UM turno, com um só
// avatar (a bússola com o badge do cliente) — o texto, o formulário e a prévia
// são partes da mesma resposta.

export type Turn =
  | { key: string; role: "user"; message: Extract<StudioMessage, { role: "user" }> }
  | { key: string; role: "assistant"; messages: Extract<StudioMessage, { role: "assistant" }>[] };

export function groupTurns(messages: readonly StudioMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ key: message.id, role: "user", message });
      continue;
    }
    const last = turns[turns.length - 1];
    if (last && last.role === "assistant") last.messages.push(message);
    else turns.push({ key: message.id, role: "assistant", messages: [message] });
  }
  return turns;
}

export function UserTurn({ text, mentionLabel }: { text: string; mentionLabel?: string }) {
  return (
    <div className="nai-turn is-user">
      <div className="nai-user-bubble">
        {mentionLabel ? <span className="nai-user-context">@{mentionLabel}</span> : null}
        <span>{text}</span>
      </div>
    </div>
  );
}

export function AssistantTurn({ client, children }: { client: { name: string } | null; children: React.ReactNode }) {
  return (
    <div className="nai-turn is-assistant">
      <NorthAiAvatar client={client} />
      <div className="nai-turn-body">
        <span className="nai-turn-author">NorthAi</span>
        {children}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: RecipeStatus }) {
  return (
    <span className={`nai-status s-${status}`}>
      <span aria-hidden className="nai-status-dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

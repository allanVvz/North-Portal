"use client";

import { STATUS_LABEL, type RecipeStatus } from "./types";

// Balões da conversa. O NorthAi fala à esquerda com a bússola; a pessoa, à direita.

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="nai-msg is-user">
      <div className="nai-bubble">{text}</div>
    </div>
  );
}

export function AssistantBubble({ children, card = false, tone }: { children: React.ReactNode; card?: boolean; tone?: "info" | "warn" | "error" }) {
  return (
    <div className="nai-msg is-assistant">
      <span className="nai-avatar" aria-hidden>N</span>
      <div className={`nai-bubble${card ? " is-card" : ""}${tone ? ` tone-${tone}` : ""}`}>{children}</div>
    </div>
  );
}

export function StatusPill({ status }: { status: RecipeStatus }) {
  return <span className={`nai-status s-${status}`}>{STATUS_LABEL[status]}</span>;
}

"use client";

import CompassMark from "@/app/brand/CompassMark";
import { initialsOf } from "@/app/avatar/initials";

// O NorthAi é a bússola da North (o asset oficial, app/brand). O cliente em que
// ele está operando entra como um badge pequeno — a North continua sendo o
// agente; a marca do cliente é o contexto. Sem cliente, só a bússola.
export default function NorthAiAvatar({ client, size = "md" }: { client: { name: string } | null; size?: "sm" | "md" }) {
  return (
    <span className={`nai-agent is-${size}`} role="img" aria-label={client ? `NorthAi operando em ${client.name}` : "NorthAi"}>
      <span className="nai-agent-mark">
        <CompassMark size={size === "sm" ? 16 : 20} />
      </span>
      {client ? <span className="nai-agent-badge" aria-hidden>{initialsOf(client.name)}</span> : null}
    </span>
  );
}

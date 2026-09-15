"use client";

import { initialsOf } from "@/app/avatar/initials";
import type { ClientLite } from "./types";

// Identidade visual do cliente no Estúdio. Não existe logo de cliente no cadastro
// hoje; o monograma (regra única de iniciais, app/avatar) é o fallback e o nome
// fica acessível. Quando houver logo, este é o único lugar a trocar.

export function ClientMonogram({ client, size = "md" }: { client: Pick<ClientLite, "name">; size?: "xs" | "sm" | "md" | "lg" }) {
  return (
    <span className={`nai-mono is-${size}`} aria-hidden>
      {initialsOf(client.name)}
    </span>
  );
}

export default function ClientIdentity({
  client,
  label,
  action,
}: {
  client: ClientLite;
  /** "Contexto ativo", "Contexto detectado"… */
  label: string;
  action?: React.ReactNode;
}) {
  const meta = [client.segment, client.city].filter(Boolean).join(" · ");
  return (
    <div className="nai-identity">
      <ClientMonogram client={client} size="lg" />
      <div className="nai-identity-text">
        <span className="nai-identity-label">{label}</span>
        <strong className="nai-identity-name">{client.name}</strong>
        {meta ? <span className="nai-identity-meta">{meta}</span> : null}
      </div>
      {action}
    </div>
  );
}

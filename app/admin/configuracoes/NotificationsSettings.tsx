"use client";

import { useEffect, useState } from "react";
import { NOTIFICATION_RULES_DEFAULT, type NotificationRules } from "@/lib/validation";

// Regras GLOBAIS da agência, gravadas em site_settings e lidas dentro do banco
// pelo leque de notificações (public.notification_rule_on).
//
// Antes disto a tela gravava em localStorage e filtrava na renderização: a
// linha continuava sendo escrita, o sino continuava contando o que a lista não
// mostrava, e a escolha valia só naquele navegador. Agora um tipo desligado
// simplesmente não vira linha — e vale para todo mundo, o que a legenda diz em
// voz alta, porque um admin silenciar a agência inteira é uma consequência que
// não pode ser descoberta por acidente.

type RuleKey = keyof NotificationRules;

const RULES: { key: RuleKey; label: string; hint: string }[] = [
  { key: "comments", label: "Comentários", hint: "Todo comentário avisa quem está envolvido no card." },
  { key: "updates", label: "Criação e edição", hint: "Card novo, mudança de status e edição do card." },
  { key: "reviewAssigned", label: "Revisão atribuída", hint: "Aviso dedicado a quem foi posto como revisor." },
  { key: "dueSoon", label: "Prazo próximo", hint: "Cards do responsável que vencem nos próximos dois dias." },
  {
    key: "notifyClients",
    label: "Contas de cliente",
    hint: "Hoje o portal não tem sino, então essas notificações ficariam sem quem as leia.",
  },
];

export default function NotificationsSettings() {
  const [rules, setRules] = useState<NotificationRules>(NOTIFICATION_RULES_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/admin/settings/notification-rules")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: NotificationRules | null) => { if (data) setRules(data); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save(patch: Partial<NotificationRules>) {
    const previous = rules;
    setRules((current) => ({ ...current, ...patch }));
    setMsg("");
    try {
      const res = await fetch("/api/admin/settings/notification-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save failed");
      setRules(await res.json());
    } catch {
      setRules(previous);
      setMsg("Não foi possível salvar.");
    }
  }

  return (
    <div className="set-card">
      <p className="set-h set-h-inline">
        Notificações <span>— quais eventos geram aviso no sino e na Home. Vale para toda a agência.</span>
      </p>

      <div className="set-visibility-divider" />

      <div className="set-notif-list">
        {RULES.map((rule) => {
          const enabled = rules[rule.key];
          return (
            <div className="set-appearance-head" key={rule.key}>
              <div>
                <h3 className="set-h3">{rule.label}</h3>
                <p className="admin-sub set-etapas-note">{rule.hint}</p>
              </div>
              <label className="admin-toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!loaded}
                  onChange={(e) => void save({ [rule.key]: e.target.checked } as Partial<NotificationRules>)}
                />
                <span className="sw" /><span>{enabled ? "Ativo" : "Silenciado"}</span>
              </label>
            </div>
          );
        })}
      </div>

      {msg ? <p className="admin-error">{msg}</p> : null}
    </div>
  );
}

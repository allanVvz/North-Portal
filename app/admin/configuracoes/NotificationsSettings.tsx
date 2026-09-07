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
type Rule = { key: RuleKey; label: string; hint: string };

// Dez interruptores numa lista plana viram uma parede. Agrupados pela PERGUNTA
// que cada um responde: o que acontece no card, o que é endereçado a você, e
// até onde o aviso alcança.
const GROUPS: { title: string; blurb: string; rules: Rule[] }[] = [
  {
    title: "Atividade do card",
    blurb: "Avisa quem está envolvido no card — responsável, revisor, aprovador e quem o criou.",
    rules: [
      { key: "comments", label: "Comentários", hint: "Todo comentário avisa quem está envolvido no card." },
      { key: "statusChanges", label: "Mudança de status", hint: "O card andou no funil: entrou em revisão, foi aprovado, parou." },
      { key: "dueChanged", label: "Prazo alterado", hint: "Mudou o prazo, o início ou o fim — o aviso já traz a data nova." },
      { key: "created", label: "Card novo", hint: "Um card foi criado, inclusive as etapas que uma entrega materializa sozinha." },
      {
        key: "edits",
        label: "Edição do card",
        hint: "Título, descrição, prioridade e afins. Desligada por padrão: era o aviso que mais enchia a caixa, e raramente é o que alguém precisava saber.",
      },
    ],
  },
  {
    title: "Direcionado a você",
    blurb: "Chega só para a pessoa em questão, não para o card inteiro.",
    rules: [
      { key: "assigned", label: "Atribuição", hint: "Você virou responsável, revisor ou aprovador de um card." },
      { key: "reviewAssigned", label: "Revisão atribuída", hint: "Aviso dedicado a quem foi posto como revisor." },
      { key: "dueSoon", label: "Prazo próximo", hint: "Cards do responsável que vencem nos próximos dois dias." },
    ],
  },
  {
    title: "Alcance",
    blurb: "Quem mais entra no leque além de quem está no card.",
    rules: [
      {
        key: "trafficRouting",
        label: "Gestor de tráfego",
        hint: "Quem está marcado na frente Gestor de tráfego (Equipe & papéis) recebe os relatórios das automações mesmo sem estar no card.",
      },
      {
        key: "notifyClients",
        label: "Contas de cliente",
        hint: "Hoje o portal não tem sino, então essas notificações ficariam sem quem as leia.",
      },
    ],
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
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="set-notif-group">{group.title}</h3>
            <p className="admin-sub set-etapas-note">{group.blurb}</p>
            {group.rules.map((rule) => {
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
          </section>
        ))}
      </div>

      {msg ? <p className="admin-error">{msg}</p> : null}
    </div>
  );
}

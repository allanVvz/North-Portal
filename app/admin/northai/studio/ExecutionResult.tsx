"use client";

import Link from "next/link";
import type { BlueprintResult } from "@/lib/northai/blueprint";
import type { RecipeMessage } from "./types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summary(message: RecipeMessage, result: BlueprintResult): { lines: string[]; after: string | null } {
  const deliveries = result.created.filter((item) => item.kind === "delivery").length;
  const steps = result.created.filter((item) => item.kind === "step").length;
  const tasks = result.created.filter((item) => item.kind === "task").length;
  const plans = result.created.filter((item) => item.kind === "plan").length;
  const routines = result.created.filter((item) => item.kind === "routine").length;
  const automations = result.created.filter((item) => item.kind === "automation").length;
  if (message.recipe === "diaria") {
    return {
      lines: [plans ? "1 plano da diária" : "", steps >= 1 ? "1 roteiro" : "", steps >= 2 ? "1 captação" : "", deliveries ? plural(deliveries, "publicação", "publicações") : ""].filter(Boolean),
      after: deliveries ? `Quando a captação for concluída, ${plural(deliveries, "edição nasce", "edições nascem")} automaticamente.` : null,
    };
  }
  return {
    lines: [
      plans ? plural(plans, "plano", "planos") : "",
      tasks ? plural(tasks, "atividade", "atividades") : "",
      routines ? plural(routines, "rotina", "rotinas") : "",
      deliveries ? plural(deliveries, "entrega", "entregas") : "",
      automations ? plural(automations, "automação", "automações") : "",
    ].filter(Boolean),
    after: deliveries && message.recipe === "fluxo" ? "Cada entrega começou na primeira etapa." : null,
  };
}

export default function ExecutionResult({ message, onRestart }: { message: RecipeMessage; onRestart: () => void }) {
  const result = message.result;
  if (!result) return null;
  const { lines, after } = summary(message, result);
  const primary =
    result.created.find((item) => item.kind === "plan") ??
    result.created.find((item) => item.kind === "delivery") ??
    result.created.find((item) => item.kind !== "automation") ??
    null;
  const hasAutomation = result.created.some((item) => item.kind === "automation");

  return (
    <div className="nai-result">
      {lines.length ? <p className="nai-result-lines">Criados: {lines.join(" · ")}</p> : null}
      {after ? <p className="nai-muted">{after}</p> : null}
      {result.error ? (
        <p className="admin-error">
          {result.created.length ? "Parou no meio: " : ""}
          {result.error}
        </p>
      ) : null}
      <div className="nai-result-actions">
        {primary ? <Link className="admin-btn primary" href={`/admin/operacao?task=${primary.id}`}>Abrir {primary.kind === "plan" ? "plano" : "card"}</Link> : null}
        {hasAutomation ? <Link className="admin-btn ghost" href="/admin/northai/automacoes">Ver automações</Link> : null}
        <Link className="admin-btn ghost" href="/admin/operacao">Abrir tarefas</Link>
        <button type="button" className="admin-btn ghost" onClick={onRestart}>Criar outra</button>
      </div>
    </div>
  );
}

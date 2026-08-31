import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { taskPayloadSchema } from "./validation";

// F dos "pontos frágeis" (docs/ARQUITETURA-TAREFAS.md): `taskPayloadSchema`
// deixou de ser `.passthrough()` e virou o CONTRATO do `payload` de uma tarefa.
// Este teste trava as duas pontas: nada de chave desconhecida entra, e nenhuma
// chave que o código realmente grava fica de fora da lista (senão o strip do
// zod a apagaria calada — a mesma classe de bug que a mudança resolve).

// Toda chave que aparece do lado ESQUERDO de uma escrita em payload de tarefa.
// Manter em ordem alfabética. Ao gravar uma chave nova no payload, adicione-a
// aqui E em taskPayloadSchema — este teste existe para forçar isso.
const CHAVES_GRAVADAS = [
  "accessed_at",
  "action_plan_id",
  "barTone",
  "comments",
  "completed_cycles",
  "cycle_completed",
  "deferred_until_accessed",
  "explicit_date_group_id",
  "explicit_occurrence_dates",
  "external_id",
  "flow_parent",
  "flow_prev_task_id",
  "flow_step_count",
  "flow_step_key",
  "flow_total_weight",
  "formato",
  "hora",
  "imported_from",
  "last_completed_at",
  "metaPostId",
  "migrated_from_recurring_task",
  "occurrence_date",
  "pct",
  "plataforma",
  "pre_parada_status",
  "publicado_em",
  "recurrence_cycle",
  "recurrence_group",
  "recurrence_last_cadence",
  "recurrence_parent_id",
  "recurrence_revision",
  "statusLabel",
  "statusTone",
] as const;

function fixtureFor(key: string): unknown {
  if (key === "comments") return [{ author: "a", text: "t", at: "2026-01-01" }];
  if (key === "statusTone" || key === "barTone") return "neutral";
  if (key === "explicit_occurrence_dates") return ["2026-01-01"];
  if (key.endsWith("_cycle") || key.endsWith("_revision") || key.endsWith("cycles") || key === "pct") return 1;
  if (key === "flow_parent" || key === "recurrence_group" || key === "deferred_until_accessed") return true;
  return "x";
}

describe("taskPayloadSchema é o contrato do payload (item F)", () => {
  it("preserva toda chave que o app grava — nenhuma cai no strip", () => {
    const fixture = Object.fromEntries(CHAVES_GRAVADAS.map((k) => [k, fixtureFor(k)]));
    const parsed = taskPayloadSchema.parse(fixture);
    for (const key of CHAVES_GRAVADAS) {
      expect(parsed, `chave "${key}" sumiu — falta em taskPayloadSchema`).toHaveProperty(key);
    }
  });

  it("descarta chave desconhecida (typo não chega ao banco)", () => {
    const parsed = taskPayloadSchema.parse({ statusTone: "gold", flow_parnet: true, xpto: 1 });
    expect(parsed).toEqual({ statusTone: "gold" });
  });

  it("a lista de chaves gravadas cobre o que o código realmente escreve", () => {
    // Varre lib/ e app/ por `payload...KEY =` / `payload.<chave> =` /
    // `[ALGUM_KEY]:` em posição de escrita, e confere contra CHAVES_GRAVADAS.
    // É uma rede grossa de propósito: um falso positivo se resolve adicionando
    // a chave real à lista (e ao schema).
    const roots = ["lib", "app"].map((d) => path.join(process.cwd(), d));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    roots.forEach(walk);

    // Constantes *_KEY / *_FLAG → o literal string que elas guardam.
    const keyConst = new Map<string, string>();
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]*(?:_KEY|_FLAG))\s*=\s*"([a-zA-Z_]+)"/g)) {
        keyConst.set(m[1], m[2]);
      }
    }

    const gravadas = new Set<string>(CHAVES_GRAVADAS);
    const faltando = new Set<string>();
    const NAO_E_PAYLOAD = new Set([
      // objetos homônimos que não são payload de tarefa
      "recurrence_cadence", "recurrence_weekdays", "recurrence_day_of_month",
    ]);

    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // payload.<chave> = ...  /  payload["<chave>"] = ...
      for (const m of src.matchAll(/\bpayload(?:\?)?\s*(?:\.\s*([a-zA-Z_][a-zA-Z0-9_]*)|\[\s*"([a-zA-Z_]+)"\s*\])\s*=(?!=)/g)) {
        const key = m[1] ?? m[2];
        if (key && !gravadas.has(key) && !NAO_E_PAYLOAD.has(key)) faltando.add(key);
      }
      // payload[ALGUMA_KEY]: ... dentro de object literal de payload
      for (const m of src.matchAll(/\[\s*([A-Z][A-Z0-9_]*(?:_KEY|_FLAG))\s*\]\s*:/g)) {
        const literal = keyConst.get(m[1]);
        if (literal && !gravadas.has(literal) && !NAO_E_PAYLOAD.has(literal)) faltando.add(literal);
      }
    }

    expect([...faltando].sort(), "chaves gravadas no payload mas ausentes de CHAVES_GRAVADAS/taskPayloadSchema").toEqual([]);
  });
});

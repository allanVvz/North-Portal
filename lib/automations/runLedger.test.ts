import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type FakeTaskDb } from "@/lib/testing/fakeTaskDb";

// O ledger (`automation_runs`) é a chave de idempotência do dia:
// (config, occurrence_key, action). `claim_automation_run` não reivindica um
// `succeeded`.
//
// Em 21/09/2026 isso custou a reexecução da CRIS CAR CARE: o tique das 11:00
// reivindicou o run, saiu por `not_due` (o vencimento era outro dia) e gravou
// `succeeded`. Quando o problema real foi resolvido e o molde foi realinhado para
// hoje, nenhum disparo mais pegava — a config era abandonada antes de o
// vencimento ser avaliado, e só destravou com UPDATE à mão no banco.
//
// O que se prova aqui: num dia sem vencimento o ledger NÃO é tocado, e por isso o
// mesmo dia continua executável quando o vencimento passa a ser hoje.

vi.setConfig({ testTimeout: 30_000 });

const hooks = vi.hoisted(() => ({ runOne: vi.fn(), conversion: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./conversionFlow", () => ({ runConversionFlow: hooks.conversion }));
vi.mock("./serviceIntegrations", () => ({
  getWindsorSettingsService: vi.fn(async () => ({})),
  getMetaSettingsService: vi.fn(async () => ({ accessToken: null })),
  adsAccountFor: vi.fn(() => null),
  getClientById: vi.fn(async () => null),
}));

import { runAutomations } from "./run";

const TODAY = "2026-09-21";
const MOLD = "molde-anuncios";
const CONFIG = "cfg-ads";

function seed(dueDate: string): FakeTaskDb {
  return createFakeTaskDb({
    automation_configs: [{
      id: CONFIG, automation_key: "relatorio_trafego_semanal", target_task_id: MOLD,
      active: true, depends_on_config_id: null, performance_template_id: null, collect_metric_keys: null,
    }],
    tasks: [{
      id: MOLD, title: "Relatório de anúncios", client_id: "cli", due_date: dueDate,
      status: "backlog", recurrence_cadence: "semanal", payload: { recurrence_cycle: 3 },
    }],
  });
}

beforeEach(() => vi.clearAllMocks());

describe("automation_runs — o ledger não é queimado por um dia sem vencimento", () => {
  it("dia SEM vencimento não grava linha nenhuma no ledger", async () => {
    const db = seed("2026-09-28");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(db.asAdmin());

    const summary = await runAutomations({ today: TODAY });

    expect(summary).toEqual({ processed: 0, succeeded: 0, errors: [] });
    // O ponto: nada de `succeeded` fantasma. Antes havia 1 linha aqui.
    expect(db.table("automation_runs")).toHaveLength(0);
    expect(db.rpcs.filter((rpc) => rpc.name === "claim_automation_run")).toHaveLength(0);
  });

  it("molde realinhado para hoje ainda executa no MESMO dia", async () => {
    const db = seed("2026-09-28");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(db.asAdmin());

    // Manhã: não vencia hoje.
    await runAutomations({ today: TODAY });
    // Alguém realinha o vencimento para hoje (foi o caso da CRIS).
    db.task(MOLD)!.due_date = TODAY;
    // Tarde: tem de rodar. Antes, a linha `succeeded` da manhã bloqueava o dia.
    const summary = await runAutomations({ today: TODAY });

    expect(db.table("automation_runs")).toHaveLength(1);
    expect(db.table("automation_runs")[0].status).not.toBe("succeeded");
    // Sem conta de anúncios mapeada a geração falha — o que importa aqui é que ela
    // FOI TENTADA em vez de a config ser abandonada no claim.
    expect(summary.processed).toBe(1);
  });

  it("recorrência encerrada não reivindica run", async () => {
    const db = seed(TODAY);
    db.task(MOLD)!.status = "parada";
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(db.asAdmin());

    await runAutomations({ today: TODAY });

    expect(db.table("automation_runs")).toHaveLength(0);
  });
});

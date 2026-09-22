import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type FakeTaskDb } from "@/lib/testing/fakeTaskDb";

// O que se prova: a falha de credencial aparece ANTES do vencimento, uma vez, e
// só para quem realmente depende da Meta. O caso real de 21/09/2026 foi um
// checkpoint que já existia na semana anterior e só apareceu na segunda.

const hooks = vi.hoisted(() => ({
  graphGet: vi.fn(),
  notify: vi.fn(async () => undefined),
  meta: vi.fn(),
  windsor: vi.fn(),
  client: vi.fn(),
}));

vi.mock("@/lib/meta", () => ({ graphGet: hooks.graphGet }));
vi.mock("./notify", () => ({ notifyFromAutomation: hooks.notify }));
vi.mock("./serviceIntegrations", async () => {
  const actual = await vi.importActual<typeof import("./serviceIntegrations")>("./serviceIntegrations");
  return {
    adsAccountFor: actual.adsAccountFor,
    getMetaSettingsService: hooks.meta,
    getWindsorSettingsService: hooks.windsor,
    getClientById: hooks.client,
  };
});

import { warnBeforeMetaCredentialFailure } from "./metaCredentialHealth";

const MOLD = "molde-trafego";
const TODAY = "2026-09-19"; // sexta; o vencimento cai na segunda seguinte

function seed(due: string): FakeTaskDb {
  return createFakeTaskDb({
    automation_configs: [{ id: "cfg-1", automation_key: "relatorio_trafego_semanal", target_task_id: MOLD, active: true }],
    tasks: [{
      id: MOLD, title: "Relatório de anúncios — Cliente X", client_id: "cli",
      due_date: due, status: "backlog", recurrence_cadence: "semanal", payload: {},
    }],
  });
}

const CHECKPOINT = new Error("Credencial da Meta bloqueada por verificação de segurança: quem conectou o North App precisa entrar em www.facebook.com...");

beforeEach(() => {
  vi.clearAllMocks();
  hooks.meta.mockResolvedValue({ configured: true, accessToken: "tok", accountMap: { "cliente-x": { accountId: "act_1", accountName: "X" } } });
  hooks.windsor.mockResolvedValue({ accountMap: {}, datasources: {}, apiKey: null });
  hooks.client.mockResolvedValue({ id: "cli", slug: "cliente-x", name: "Cliente X" });
});

describe("warnBeforeMetaCredentialFailure", () => {
  it("avisa no card dois dias antes do vencimento quando a Meta recusa", async () => {
    hooks.graphGet.mockRejectedValue(CHECKPOINT);
    const db = seed("2026-09-21");

    expect(await warnBeforeMetaCredentialFailure(db.asAdmin(), TODAY)).toBe(1);

    const [comment] = db.comments(MOLD);
    expect(String(comment.text)).toContain("corre risco de não ser gerado");
    expect(String(comment.text)).toContain("www.facebook.com");
    expect(comment.id).toBe("meta-credential:cfg-1:2026-09-21");
    expect(hooks.notify).toHaveBeenCalledTimes(1);
  });

  it("não repete o aviso para o mesmo vencimento", async () => {
    hooks.graphGet.mockRejectedValue(CHECKPOINT);
    const db = seed("2026-09-21");

    await warnBeforeMetaCredentialFailure(db.asAdmin(), TODAY);
    expect(await warnBeforeMetaCredentialFailure(db.asAdmin(), "2026-09-20")).toBe(0);

    expect(db.comments(MOLD)).toHaveLength(1);
  });

  it("cala quando a credencial está boa", async () => {
    hooks.graphGet.mockResolvedValue({ id: "1" });
    const db = seed("2026-09-21");

    expect(await warnBeforeMetaCredentialFailure(db.asAdmin(), TODAY)).toBe(0);
    expect(db.comments(MOLD)).toHaveLength(0);
  });

  it("não gasta chamada na Meta quando nenhum vencimento está próximo", async () => {
    const db = seed("2026-10-05");

    expect(await warnBeforeMetaCredentialFailure(db.asAdmin(), TODAY)).toBe(0);
    expect(hooks.graphGet).not.toHaveBeenCalled();
  });

  it("cala para cliente que puxa dados do Windsor — não depende deste token", async () => {
    hooks.graphGet.mockRejectedValue(CHECKPOINT);
    hooks.meta.mockResolvedValue({ configured: true, accessToken: "tok", accountMap: {} });
    hooks.windsor.mockResolvedValue({ accountMap: { "cliente-x": { accountId: "w_1" } }, datasources: {}, apiKey: "k" });
    const db = seed("2026-09-21");

    expect(await warnBeforeMetaCredentialFailure(db.asAdmin(), TODAY)).toBe(0);
    expect(db.comments(MOLD)).toHaveLength(0);
  });

  it("cala quando a recorrência foi encerrada de propósito", async () => {
    hooks.graphGet.mockRejectedValue(CHECKPOINT);
    const db = seed("2026-09-21");
    db.table("tasks")[0].status = "parada";

    expect(await warnBeforeMetaCredentialFailure(db.asAdmin(), TODAY)).toBe(0);
  });
});

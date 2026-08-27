import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchDriveThumbnail, isGoogleDriveConfigured } from "./googleDriveApi";

// A integração com o Drive é opcional. Sem a conta de serviço, a capa do card
// ainda tenta o endpoint público do Drive (é o que faz a capa existir sem
// credencial nenhuma); quando nem isso responde, a capa precisa simplesmente
// não aparecer — nunca quebrar a tela, nem fazer a rota devolver 500.
// Ver plan/CARD-COVER-PREVIEW.md, "Degradação".
//
// O ambiente é zerado dentro do teste em vez de confiar em como a máquina está
// configurada: senão isto passaria no CI e falharia no laptop de quem tem o
// Drive ligado, que é o pior tipo de teste. O `fetch` é dublado pelo mesmo
// motivo — teste não fala com a rede.
describe("capa sem Drive configurado", () => {
  const saved = {
    account: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
    folder: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
  };

  beforeEach(() => {
    delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved.account === undefined) delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = saved.account;
    if (saved.folder === undefined) delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = saved.folder;
  });

  function stubFetch(response: { ok: boolean; contentType?: string }) {
    const spy = vi.fn(async (url: string | URL) => {
      void url;
      return {
        ok: response.ok,
        headers: { get: () => response.contentType ?? null },
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("a integração se declara não configurada", () => {
    expect(isGoogleDriveConfigured()).toBe(false);
  });

  it("tenta o endpoint público do Drive, sem credencial", async () => {
    const spy = stubFetch({ ok: true, contentType: "image/jpeg" });
    const thumb = await fetchDriveThumbnail("1AaBbCcDdEeFfGgHhIiJjKkLl");

    expect(thumb?.contentType).toBe("image/jpeg");
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain("drive.google.com/thumbnail?id=1AaBbCcDdEeFfGgHhIiJjKkLl");
  });

  it("arquivo não compartilhado devolve null em vez de lançar", async () => {
    stubFetch({ ok: false });
    await expect(fetchDriveThumbnail("1AaBbCcDdEeFfGgHhIiJjKkLl")).resolves.toBeNull();
  });

  it("página HTML de erro não passa por imagem", async () => {
    // O Drive às vezes responde 200 com uma página de erro; o tipo importa
    // tanto quanto o status.
    stubFetch({ ok: true, contentType: "text/html; charset=UTF-8" });
    await expect(fetchDriveThumbnail("1AaBbCcDdEeFfGgHhIiJjKkLl")).resolves.toBeNull();
  });

  it("id vazio nem chega a pedir nada", async () => {
    const spy = stubFetch({ ok: true, contentType: "image/jpeg" });
    await expect(fetchDriveThumbnail("")).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

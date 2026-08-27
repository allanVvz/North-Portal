import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fetchDriveThumbnail, isGoogleDriveConfigured } from "./googleDriveApi";

// A integração com o Drive é opcional. Sem as variáveis de ambiente, a capa do
// card precisa simplesmente não aparecer — nunca quebrar a tela, e nunca fazer
// a rota devolver 500. Ver plan/CARD-COVER-PREVIEW.md, "Degradação".
//
// O ambiente é zerado dentro do teste em vez de confiar em como a máquina está
// configurada: senão isto passaria no CI e falharia no laptop de quem tem o
// Drive ligado, que é o pior tipo de teste.
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
    if (saved.account === undefined) delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = saved.account;
    if (saved.folder === undefined) delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = saved.folder;
  });

  it("a integração se declara não configurada", () => {
    expect(isGoogleDriveConfigured()).toBe(false);
  });

  it("a miniatura devolve null em vez de lançar", async () => {
    await expect(fetchDriveThumbnail("1AaBbCcDdEeFfGgHhIiJjKkLl")).resolves.toBeNull();
  });

  it("id vazio também devolve null", async () => {
    await expect(fetchDriveThumbnail("")).resolves.toBeNull();
  });
});

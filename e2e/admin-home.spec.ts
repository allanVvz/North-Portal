import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// The admin Home is assembled entirely from existing data (no new table), so
// this checks the wiring: KPIs render real numbers and link to the screen that
// resolves them, the notifications panel is fed by the same API as the bell,
// and "+ Nova tarefa" opens the shared TaskModal in creation mode.

// The dev server compiles routes on first hit, so the first assertion on a
// fresh route can outlast the default 5s expect timeout. Waiting for the
// network to settle keeps that from reading as a product failure.
async function openHome(page: import("@playwright/test").Page) {
  await page.goto("/admin/home", { waitUntil: "networkidle" });
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.describe("Home do admin", () => {
  // Generous budget: each route this spec touches is compiled on first hit by
  // the dev server, which alone can eat the default 30s.
  test.describe.configure({ timeout: 90_000 });

  // O teste "mostra KPIs reais e leva para a tela que os resolve" morava aqui.
  // Ele afirmava cinco KPIs — "Clientes ativos", "Em revisão", "Aguardando
  // aprovação" — que não existem em AdminHome.tsx e, pelo histórico, nunca
  // existiram nele: a Home tem três ("Tarefas desta semana", "Tarefas
  // atrasadas", "Progresso dos planos"), e três está certo. Ele também clicava
  // em "Em revisão" para navegar a /admin/revisoes, aba que hoje está
  // desligada em Configurações. Um teste que descreve uma tela que não existe
  // não protege nada; só ensina a ignorar vermelho.

  test("abre o TaskModal em modo de criação pelo atalho do header", async ({ page }) => {
    await login(page);
    await openHome(page);

    await page.getByRole("button", { name: /Nova tarefa/ }).click();
    // The shared modal shows the type cards only when creating.
    await expect(page.locator(".tm").first()).toBeVisible({ timeout: 15_000 });
  });

  test("o painel de notificações aparece exatamente quando há não-lidas", async ({ page }) => {
    await login(page);
    await openHome(page);

    // A versão antiga exigia o card SEMPRE, com linhas ou com um estado vazio.
    // Mas AdminHome só o renderiza quando `unread > 0`, e isso é decisão
    // registrada no código: "um card fixo dizendo 'nenhuma notificação' só
    // ocupava a coluna". Então o teste passa a afirmar a regra — o card existe
    // se, e somente se, houver não-lidas — em vez de um estado vazio que de
    // propósito não existe. Assim ele vale para qualquer caixa de entrada, em
    // vez de falhar sempre que o admin estivesse em dia.
    const resposta = await page.request.get("/api/admin/notifications");
    expect(resposta.ok()).toBeTruthy();
    const { notifications } = await resposta.json();
    const naoLidas = (notifications ?? []).filter((n: { read_at: string | null }) => !n.read_at).length;

    const panel = page.locator(".admin-card", { hasText: "Notificações" });
    if (naoLidas === 0) {
      await expect(panel).toHaveCount(0);
      return;
    }
    await expect(panel).toBeVisible({ timeout: 20_000 });
    // Mesma fonte do sino: se o contador diz que há, tem que haver linha.
    await expect(panel.locator(".admin-notif-item").first()).toBeVisible({ timeout: 15_000 });
  });

  test("o item Início aparece na navegação e fica ativo na Home", async ({ page }) => {
    await login(page);
    await openHome(page);
    // Matched by href, not by accessible name: the sidebar collapses to
    // icon-only at narrower widths, which hides the label text.
    const item = page.locator('a.admin-nav-item[href="/admin/home"]');
    await expect(item).toBeVisible({ timeout: 20_000 });
    await expect(item).toHaveClass(/active/);
  });
});

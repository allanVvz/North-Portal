import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

const TITLE = `[e2e ${Date.now()}] Progresso do modal`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais do Supabase ausentes.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.describe("progresso do modal de tarefa", () => {
  let sb: SupabaseClient;
  let taskId = "";

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`Cliente para E2E não encontrado: ${clientError?.message}`);
    const { data: task, error } = await sb.from("tasks").insert({
      client_id: client.id,
      kind: "operacional",
      title: TITLE,
      status: "backlog",
      priority: "media",
    }).select("id").single();
    if (error || !task) throw new Error(`Falha ao criar tarefa E2E: ${error?.message}`);
    taskId = task.id as string;
  });

  test.afterAll(async () => {
    if (taskId) await sb.from("tasks").delete().eq("id", taskId);
  });

  test("respeita a flag visual e acompanha o status antes e depois de salvar", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.evaluate(() => localStorage.setItem("kb-attr-visible", JSON.stringify({ progress: false })));
    await page.goto("/admin/kanban");

    await page.locator(".kb-card", { hasText: TITLE }).click();
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".tm-head-progress")).toHaveCount(0);
    const desktopLayout = await modal.evaluate((element) => {
      const identity = element.querySelector(".tm-head-identity")!.getBoundingClientRect();
      const stepper = element.querySelector(".tm-stepper-head")!.getBoundingClientRect();
      const actions = element.querySelector(".tm-head-actions")!.getBoundingClientRect();
      const footer = element.querySelector(".kb-modal-actions")!.getBoundingClientRect();
      const modalRect = element.getBoundingClientRect();
      const steps = Array.from(element.querySelectorAll(".tm-step"));
      return {
        centerDelta: Math.abs((stepper.left + stepper.width / 2) - (identity.right + actions.left) / 2),
        lastStepHasLine: Boolean(steps.at(-1)?.querySelector(".tm-step-line")),
        lineCount: element.querySelectorAll(".tm-step-line").length,
        stepCount: steps.length,
        footerBottomDelta: Math.abs(modalRect.bottom - footer.bottom),
        horizontalOverflow: element.scrollWidth > element.clientWidth,
      };
    });
    expect(desktopLayout.centerDelta).toBeLessThan(2);
    expect(desktopLayout.lastStepHasLine).toBe(false);
    expect(desktopLayout.lineCount).toBe(desktopLayout.stepCount - 1);
    expect(desktopLayout.footerBottomDelta).toBeLessThan(2);
    expect(desktopLayout.horizontalOverflow).toBe(false);

    // Description is a click-to-edit view (feat: clickable card description) —
    // double-click the read view to reveal the textarea before interacting with it.
    await modal.locator(".tm-desc-view").dblclick();
    const description = modal.getByPlaceholder(/Objetivo, referência e critério/);
    const initialDescriptionHeight = await description.evaluate((element) => element.getBoundingClientRect().height);
    await description.fill("Linha 1\nLinha 2\nLinha 3\nLinha 4\nLinha 5\nLinha 6");
    await expect.poll(() => description.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(initialDescriptionHeight);

    await page.setViewportSize({ width: 1024, height: 768 });
    const responsiveHeader = await modal.locator(".tm-stepper-head").evaluate((element) => ({
      borderTopWidth: getComputedStyle(element).borderTopWidth,
      horizontalOverflow: element.scrollWidth > element.clientWidth,
    }));
    expect(responsiveHeader.borderTopWidth).toBe("0px");
    expect(responsiveHeader.horizontalOverflow).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await modal.evaluate((element) => {
      const modalRect = element.getBoundingClientRect();
      const layout = element.querySelector(".tm-layout")!.getBoundingClientRect();
      const descriptionBox = element.querySelector(".tm-main > .tm-box:has(.tm-desc-input)")!.getBoundingClientRect();
      const comments = element.querySelector(".tm-side")!.getBoundingClientRect();
      const footer = element.querySelector(".kb-modal-actions")!.getBoundingClientRect();
      return {
        commentsClearDescription: comments.top >= descriptionBox.bottom,
        footerAfterLayout: footer.top >= layout.bottom - 2,
        footerBottomDelta: Math.abs(modalRect.bottom - footer.bottom),
        horizontalOverflow: element.scrollWidth > element.clientWidth,
      };
    });
    expect(mobileLayout.commentsClearDescription).toBe(true);
    expect(mobileLayout.footerAfterLayout).toBe(true);
    expect(mobileLayout.footerBottomDelta).toBeLessThan(2);
    expect(mobileLayout.horizontalOverflow).toBe(false);

    await page.evaluate(() => {
      localStorage.setItem("kb-attr-visible", JSON.stringify({ progress: true }));
      window.dispatchEvent(new Event("kb-attr-visible-change"));
    });
    await expect(modal.locator(".tm-head-progress b")).toHaveText("0%");

    await modal.getByRole("button", { name: "Em produção", exact: true }).click();
    await expect(modal.locator(".tm-head-progress b")).toHaveText("60%");
    await modal.getByRole("button", { name: "Concluído", exact: true }).click();
    await expect(modal.locator(".tm-head-progress b")).toHaveText("100%");
    await expect(modal.getByRole("button", { name: "Salvar card" })).toHaveCount(0);
    await expect(modal.getByRole("status")).toHaveText("Salvo", { timeout: 20_000 });
    await modal.getByRole("button", { name: "Fechar", exact: true }).last().click();
    await expect(modal).toBeHidden({ timeout: 20_000 });

    const { data, error } = await sb.from("tasks").select("status").eq("id", taskId).single();
    if (error) throw error;
    expect(data.status).toBe("aprovado");
  });
});

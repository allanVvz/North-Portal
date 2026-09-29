import { expect, test } from "@playwright/test";
import { openAdminSession } from "./adminSession";

const PLAN = "7e1a162d-ff0f-414e-ad50-bea8b472fbcd";
const CYCLE = "e5f32ccc-154a-4d11-b5dc-1098bec58fcc";
const MOLD = "71e87469-990b-416e-9d0e-a6f57e781343";
const REELS = ["08adb443-4d3a-4c38-8b32-be1b27cc111b", "ea692a3d-c5c5-483d-858b-a39fd8f3f228", "0ab2f61f-ed5b-4e2a-85ec-7dc7353fa12e", "b2606f88-b8c7-43c6-a148-df67bc409eaf", "ee864705-afbd-4b72-a6df-d7be55046695", "b5a0f9ec-a1a0-480e-ac23-4e2b8978a4a1"];
const ADS = ["1f8e78d6-28b2-49ae-8fa9-ceaaaf757eff", "c1799c11-dba5-41cb-862c-2b5ed1159e00"];

test("plano Baita no ciclo North com Edição e Publicação por peça", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openAdminSession(page);
  const response = await page.request.get("/api/admin/tasks");
  expect(response.ok()).toBeTruthy();
  const { tasks } = await response.json() as { tasks: Array<{
    id: string; client_id: string | null; plan_id: string | null; subtype: string | null;
    payload: Record<string, unknown>; parents: Array<{ id: string; relation_kind: string; slot: string | null }>;
  }> };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const plan = byId.get(PLAN)!;
  const cycle = byId.get(CYCLE)!;
  expect(plan).toBeTruthy();
  expect(cycle).toBeTruthy();
  expect(plan.client_id).not.toBe(cycle.client_id);
  expect(plan.plan_id).toBeNull();
  expect(cycle.plan_id).toBe(MOLD);
  expect(plan.parents).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: CYCLE, relation_kind: "structural_member" })]));
  const linkedResponse = await page.request.get(`/api/admin/tasks/${MOLD}/routine-executions`);
  expect(linkedResponse.ok()).toBeTruthy();
  const { links } = await linkedResponse.json() as { links: Array<{ cycle_id: string; occurrence_date: string; task_id: string }> };
  expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ cycle_id: CYCLE, occurrence_date: "2026-09-16", task_id: PLAN })]));
  const conversationResponse = await page.request.get(`/api/admin/tasks/${MOLD}/conversation`);
  expect(conversationResponse.ok()).toBeTruthy();
  const { items: meetingItems } = await conversationResponse.json() as { items: Array<{ taskId: string; taskTitle: string; path: string[]; meetingDate: string | null; kind: string }> };
  // O plano não tem comentário próprio; a projeção deve trazer os cards dele
  // com origem e data da reunião explícita.
  expect(meetingItems.some((item) => item.meetingDate === "2026-09-16"
    && item.path.includes("PLANO DE CONTEÚDO - SETEMBRO /OUTUBRO")
    && item.taskId === "b5a0f9ec-a1a0-480e-ac23-4e2b8978a4a1")).toBe(true);
  for (const id of [...REELS, ...ADS]) {
    const delivery = byId.get(id)!;
    expect(delivery).toBeTruthy();
    const edit = tasks.filter((task) => task.subtype === "edicao" && task.parents.some((link) => link.id === id && link.slot === "edicao"));
    expect(edit).toHaveLength(1);
    expect(edit[0].payload.reviewer_ids).toEqual(expect.arrayContaining([
      "ab1079a3-6627-4fba-8238-2557243c4fdc", "c87b2f9b-7c23-4539-945a-985ccddfa856",
    ]));
    expect(byId.get(String(delivery.payload.prepared_publication_task_id))?.subtype).toBe("publicacao");
  }
  await page.goto(`/admin/kanban?task=${MOLD}`);
  const modal = page.locator(".tm");
  await expect(modal.locator(".tm-title-input")).toHaveValue(/REUNIÃO ROTINA - ALLAN/, { timeout: 30_000 });
  await expect(modal.getByText(/Reunião 16 de set/i)).toBeVisible();
  await expect(modal.getByText("PLANO DE CONTEÚDO - SETEMBRO /OUTUBRO").first()).toBeVisible();
  await expect(modal.getByLabel("Desvincular PLANO DE CONTEÚDO - SETEMBRO /OUTUBRO desta reunião").first()).toBeVisible();
  await page.goto(`/admin/kanban?task=${PLAN}`);
  const planModal = page.locator(".tm");
  await expect(planModal.locator(".tm-title-input")).toHaveValue(/PLANO DE CONTEÚDO - SETEMBRO \/OUTUBRO/, { timeout: 30_000 });
  await expect(planModal.getByText("Comentando neste plano")).toBeVisible();
  await expect(planModal.getByText("Destino do comentário")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(planModal).toBeVisible();
  await expect(planModal.getByText(/Atividades do plano \(13\)/i)).toBeVisible();
  await expect(planModal.locator(".tm-comment-input")).toBeVisible();
  const widthCheck = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(widthCheck.page).toBeLessThanOrEqual(widthCheck.viewport);
  await planModal.screenshot({ path: testInfo.outputPath("baita-plan-390.png") });
  await planModal.locator(".tm-comment-input").evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(planModal.locator(".tm-comment-input").getByRole("button", { name: "Enviar" })).toBeInViewport();
  const composerBox = await planModal.locator(".tm-comment-input").boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y).toBeGreaterThanOrEqual(0);
  const footerTop = await planModal.locator(".kb-modal-actions").evaluate((footer) => footer.getBoundingClientRect().top);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(footerTop);
  await planModal.screenshot({ path: testInfo.outputPath("baita-plan-composer-390.png") });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./googleDriveApi", () => ({}));

describe("formato de várias peças", () => {
  it("carrossel e story têm Def e peças que valem juntas; vídeo e post, um final", async () => {
    const { isMultiItemFormat } = await import("./creativeDrive");
    expect(["Carrossel", "Story", "stories"].map(isMultiItemFormat)).toEqual([true, true, true]);
    expect(["Reels", "Anúncio", "Banner", "", null].map(isMultiItemFormat)).toEqual([false, false, false, false, false]);
  });
});

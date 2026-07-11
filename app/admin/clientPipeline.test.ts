import { describe, expect, it } from "vitest";
import { clientStageFor } from "./clientPipeline";

describe("clientStageFor", () => {
  it("is Criação when nothing has started", () => {
    expect(clientStageFor(false, 0)).toBe("criacao");
  });

  it("is Onboarding once briefing is submitted, even with 0% checkpoints", () => {
    expect(clientStageFor(true, 0)).toBe("onboarding");
  });

  it("is Onboarding once checkpoints are underway, even without briefing", () => {
    expect(clientStageFor(false, 40)).toBe("onboarding");
  });

  it("is Em Operação once checkpoints reach 100%, regardless of briefing", () => {
    expect(clientStageFor(true, 100)).toBe("operacao");
    expect(clientStageFor(false, 100)).toBe("operacao");
  });

  it("treats over 100% defensively as Em Operação too", () => {
    expect(clientStageFor(true, 120)).toBe("operacao");
  });
});

import { describe, expect, it } from "vitest";
import { parseFeedbackDecision } from "./internalFeedback";

describe("feedback decision", () => {
  it("accepts only an explicit AI classification token", () => {
    expect(parseFeedbackDecision("aprovar")).toBe("aprovar");
    expect(parseFeedbackDecision("ajustes")).toBe("ajustes");
    expect(parseFeedbackDecision("não aprovar")).toBe("revisao");
    expect(parseFeedbackDecision("talvez aprovado")).toBe("revisao");
  });
});

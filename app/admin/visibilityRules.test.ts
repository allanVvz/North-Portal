import { describe, expect, it } from "vitest";
import { shouldRenderClientVisibilityToggle } from "./visibilityRules";

describe("toggle visível para o cliente", () => {
  it("nunca aparece quando a feature flag está desligada ou ainda não carregou", () => {
    expect(shouldRenderClientVisibilityToggle(false)).toBe(false);
    expect(shouldRenderClientVisibilityToggle(null)).toBe(false);
    expect(shouldRenderClientVisibilityToggle(undefined)).toBe(false);
  });

  it("só aparece com a feature flag explicitamente ligada", () => {
    expect(shouldRenderClientVisibilityToggle(true)).toBe(true);
  });
});

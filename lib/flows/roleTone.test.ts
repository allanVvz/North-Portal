import { describe, expect, it } from "vitest";
import { RESPONSIBILITY_KEYS } from "@/lib/validation";
import { ROLE_LABEL, roleTone } from "./roleTone";

describe("roleTone", () => {
  it("as 5 responsabilidades têm uma tonalidade cada", () => {
    for (const key of RESPONSIBILITY_KEYS) {
      expect(roleTone(key)).toMatch(/^t-tone-/);
    }
  });

  it("as 5 tonalidades são distintas entre si", () => {
    const tones = RESPONSIBILITY_KEYS.map((key) => roleTone(key));
    expect(new Set(tones).size).toBe(RESPONSIBILITY_KEYS.length);
  });
});

describe("ROLE_LABEL", () => {
  it("toda responsabilidade tem um rótulo em português", () => {
    for (const key of RESPONSIBILITY_KEYS) {
      expect(typeof ROLE_LABEL[key]).toBe("string");
      expect(ROLE_LABEL[key].length).toBeGreaterThan(0);
    }
  });
});

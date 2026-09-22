import { describe, expect, it } from "vitest";
import { creativeCardsPattern } from "./reportBlocks";

describe("creativeCardsPattern", () => {
  it.each([
    [1, "wide"],
    [2, "pair"],
    [3, "featured_stack"],
    [4, "grid_2x2"],
  ] as const)("usa o formato correto para %i destaque(s)", (count, expected) => {
    expect(creativeCardsPattern(count)).toBe(expected);
  });
});

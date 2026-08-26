import { describe, expect, it } from "vitest";
import { sanitizeMutedTypes } from "./notificationPrefs";

describe("sanitizeMutedTypes", () => {
  it("returns an empty list when given nothing", () => {
    expect(sanitizeMutedTypes(undefined)).toEqual([]);
    expect(sanitizeMutedTypes(null)).toEqual([]);
  });

  it("returns an empty list for malformed (non-array) input", () => {
    expect(sanitizeMutedTypes("task_due_soon")).toEqual([]);
    expect(sanitizeMutedTypes({ task_due_soon: true })).toEqual([]);
    expect(sanitizeMutedTypes(42)).toEqual([]);
  });

  it("keeps only known notification types", () => {
    expect(sanitizeMutedTypes(["task_due_soon", "not_a_real_type", "task_commented"])).toEqual([
      "task_due_soon",
      "task_commented",
    ]);
  });

  it("drops a type that no longer exists in NOTIFICATION_TYPES", () => {
    expect(sanitizeMutedTypes(["task_review_assigned", "legacy_removed_type"])).toEqual(["task_review_assigned"]);
  });

  it("de-duplicates repeated entries", () => {
    expect(sanitizeMutedTypes(["task_due_soon", "task_due_soon"])).toEqual(["task_due_soon"]);
  });
});

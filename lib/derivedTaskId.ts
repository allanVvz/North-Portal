import { createHash } from "node:crypto";

/**
 * A UUID derived deterministically from a parent id + a stable identity string.
 *
 * This is the idempotency mechanism for every "a card creates another card"
 * path in the app. The point is that the derived id is a pure function of
 * (parent, identity): a second attempt to materialize the same child produces
 * the same primary key and collides (23505) instead of silently inserting a
 * duplicate.
 *
 * A unique index alone is NOT enough — the recurrence feature learned this the
 * hard way. A retry that runs after the parent's schedule already advanced
 * writes a *different* due_date, so `unique(parent, due_date)` never fires and
 * a double-click quietly produces two cycles. The identity has to be the thing
 * that stays stable across the retry (the cycle number, the flow step key),
 * never an editable field.
 *
 * Shaped as a v5-style UUID (version nibble 5, RFC-4122 variant bits) so it is
 * indistinguishable from a random uuid to Postgres and to every reader.
 */
export function derivedTaskId(parentId: string, identity: string): string {
  const digest = createHash("sha256").update(`${parentId}:${identity}`).digest("hex").slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((parseInt(digest[16], 16) & 3) | 8).toString(16);
  return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
}

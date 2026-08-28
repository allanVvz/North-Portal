import { derivedTaskId } from "@/lib/derivedTaskId";

/**
 * The id a given step of a given delivery will always have.
 *
 * This is the only thing standing between "each card creates the next" and a
 * board full of duplicates. Dragging a card to Concluído, back to Em produção,
 * and to Concluído again fires the cascade twice; the reconciler in the daily
 * cron can fire it a third time. All three compute the same id, so the second
 * and third inserts collide on the primary key (23505) and are no-ops.
 *
 * The identity is `step_key`, never the title, the order_index or the due
 * date — all three are editable, and an identity that can be edited is not an
 * identity. Recurrence learned this the hard way (see the clientes-recorrencias
 * notes): a unique index over an editable column silently lets the retry
 * through because the retry writes a different value.
 */
export function flowStepTaskId(deliveryId: string, stepKey: string): string {
  return derivedTaskId(deliveryId, `flow-step:${stepKey}`);
}

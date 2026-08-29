// Assinaturas do script de backfill, para que `lib/derivedTaskId.test.ts` possa
// importá-lo e afirmar que a cópia do hash de identidade não divergiu da
// original em `lib/derivedTaskId.ts`. Sem isto o `.mjs` entra como `any`
// implícito e o typecheck reprova (TS7016).
export function derivedTaskId(parentId: string, identity: string): string;
export function flowStepTaskId(deliveryId: string, stepKey: string): string;

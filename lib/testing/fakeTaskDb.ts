// Banco em memória para os testes de comentário e avanço de etapas.
//
// Modela só o que importa para as corridas em jogo:
//   - cada operação (select/update/insert/rpc) executa ATOMICAMENTE, em um passo
//     do event loop, e cede a vez antes — então `Promise.all` de dois fluxos e
//     um comentário "no meio" de uma geração se intercalam de verdade;
//   - o trigger `tasks_sync_completed_at`: `completed_at` segue o status
//     (`aprovado` carimba, qualquer outro status limpa) — é por causa dele que
//     um `.update({ status })` incondicional REABRE uma etapa concluída;
//   - as chaves únicas que sustentam a idempotência (`tasks.id`,
//     `task_links (parent_id, child_id)`, `(parent_id, workflow_step_id)`,
//     `traffic_reports (task_id, revision)`), com o mesmo código 23505;
//   - as RPCs `automation_task_payload_update` e `append_task_comment_idempotent`,
//     espelhando supabase/migrations/20260918150000_atomic_task_comments.sql.
//
// É um espelho, não o Postgres: o contrato SQL real é conferido por
// supabase/postflight/20260918_atomic_task_comments_smoke.sql.

import type { AdminClient } from "@/lib/automations/taskAccess";

export type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };
type Result = { data: Row[] | null; error: DbError | null };

const TERMINAL_STATUSES = new Set(["aprovado"]);
const MAX_COMMENTS = 200;

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

function valueAt(row: Row, column: string): unknown {
  if (!column.includes("->>")) return row[column];
  const [base, key] = column.split("->>");
  const json = row[base];
  return json && typeof json === "object" ? (json as Row)[key] : undefined;
}

// ---- Semântica das RPCs (espelho do SQL) ------------------------------------

type PayloadUpdateArgs = {
  p_comment_text?: string | null;
  p_comment_id?: string | null;
  p_comment_author?: string | null;
  p_patch?: Row | null;
  p_remove?: string[] | null;
};

export function applyAutomationPayloadUpdate(payload: Row | null | undefined, args: PayloadUpdateArgs, now: string): { payload: Row; inserted: boolean } {
  const patch = args.p_patch ?? {};
  const remove = args.p_remove ?? [];
  if ("comments" in patch || remove.includes("comments")) throw new Error("O thread de comentários só muda por comentário");
  if (args.p_comment_text != null && !args.p_comment_text.trim()) throw new Error("Comentário inválido");

  const next: Row = { ...(payload ?? {}) };
  for (const key of remove) delete next[key];
  Object.assign(next, patch);

  let inserted = false;
  if (args.p_comment_text != null) {
    const thread = Array.isArray(next.comments) ? [...(next.comments as Row[])] : [];
    const already = args.p_comment_id != null && thread.some((comment) => comment.id === args.p_comment_id);
    if (!already) {
      thread.push({
        ...(args.p_comment_id != null ? { id: args.p_comment_id } : {}),
        author: args.p_comment_author || "Automação",
        text: args.p_comment_text,
        at: now,
      });
      next.comments = thread.slice(-MAX_COMMENTS);
      inserted = true;
    }
  }
  return { payload: next, inserted };
}

type HumanCommentArgs = { p_task_id: string; p_author_id: string; p_text: string; p_comment_id?: string | null };

// ---- Builder ----------------------------------------------------------------

class Query implements PromiseLike<Result> {
  private mode: "select" | "update" | "insert" | "delete" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private patch: Row = {};
  private toInsert: Row[] = [];
  private returning = true;
  private max: number | null = null;
  private orderBy: string | null = null;
  private descending = false;

  constructor(private readonly db: FakeTaskDb, private readonly table: string) {}

  select(): this { if (this.mode !== "select") this.returning = true; return this; }
  update(patch: Row): this { this.mode = "update"; this.patch = patch; this.returning = false; return this; }
  insert(rows: Row | Row[]): this { this.mode = "insert"; this.toInsert = Array.isArray(rows) ? rows : [rows]; this.returning = false; return this; }
  delete(): this { this.mode = "delete"; this.returning = false; return this; }
  eq(column: string, value: unknown): this { this.filters.push((row) => valueAt(row, column) === value); return this; }
  neq(column: string, value: unknown): this { this.filters.push((row) => valueAt(row, column) !== value); return this; }
  in(column: string, values: readonly unknown[]): this { this.filters.push((row) => values.includes(valueAt(row, column))); return this; }
  is(column: string, value: null): this { this.filters.push((row) => (valueAt(row, column) ?? null) === value); return this; }
  not(column: string, operator: string, value: unknown): this {
    if (operator === "in") {
      const list = String(value).replace(/^\(|\)$/g, "").split(",").map((item) => item.trim());
      this.filters.push((row) => !list.includes(String(valueAt(row, column))));
    } else if (operator === "is" && value === null) {
      this.filters.push((row) => valueAt(row, column) != null);
    } else {
      throw new Error(`FakeTaskDb: not(${operator}) não suportado`);
    }
    return this;
  }
  lt(column: string, value: number | string): this { this.filters.push((row) => this.compare(valueAt(row, column), value) < 0); return this; }
  lte(column: string, value: number | string): this { this.filters.push((row) => this.compare(valueAt(row, column), value) <= 0); return this; }
  gt(column: string, value: number | string): this { this.filters.push((row) => this.compare(valueAt(row, column), value) > 0); return this; }
  gte(column: string, value: number | string): this { this.filters.push((row) => this.compare(valueAt(row, column), value) >= 0); return this; }
  /** Números como números; datas ISO ('2026-09-20') e texto como texto. */
  private compare(a: unknown, b: number | string): number {
    if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  }
  order(column: string, options?: { ascending?: boolean }): this { this.orderBy = column; this.descending = options?.ascending === false; return this; }
  limit(count: number): this { this.max = count; return this; }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<Result> {
    // Cede a vez: é o que permite duas chamadas concorrentes se intercalarem
    // entre operações (nunca DENTRO de uma).
    await Promise.resolve();
    const rows = this.db.table(this.table);
    const matching = () => rows.filter((row) => this.filters.every((filter) => filter(row)));

    if (this.mode === "insert") {
      const inserted: Row[] = [];
      for (const raw of this.toInsert) {
        const conflict = this.db.uniqueViolation(this.table, raw);
        if (conflict) return { data: null, error: { code: "23505", message: conflict } };
        const row = this.db.normalize(this.table, { ...raw });
        rows.push(row);
        this.db.inserts.push({ table: this.table, row });
        inserted.push(row);
        // task_links_refresh_rollup_parent: ligar uma etapa reprojeta o pai.
        if (this.table === "task_links" && row.relation_kind === "workflow_step") this.db.refreshParent(String(row.parent_id));
      }
      return { data: this.returning ? inserted.map((row) => ({ ...row })) : null, error: null };
    }

    if (this.mode === "update") {
      const targets = matching();
      if (this.table === "conversion_report_snapshots" && targets.length) {
        return { data: null, error: { code: "23514", message: "conversion_report_snapshots are append-only" } };
      }
      // Trigger tasks_reject_manual_rollup_status: uma escrita DIRETA de status em
      // Entrega, Plano ou molde recorrente é recusada (o status deles é projetado).
      // O statement falha inteiro, como no Postgres.
      if (this.table === "tasks" && "status" in this.patch) {
        const blocked = targets.find((row) => this.db.isProjectedParent(row) && row.status !== this.patch.status);
        if (blocked) return { data: null, error: { code: "23514", message: "Parent card status is projected from descendants" } };
      }
      for (const row of targets) {
        const before = { ...row };
        Object.assign(row, this.patch);
        this.db.afterUpdate(this.table, row, before);
        this.db.updates.push({ table: this.table, id: row.id, patch: { ...this.patch } });
      }
      return { data: this.returning ? targets.map((row) => ({ ...row })) : null, error: null };
    }

    if (this.mode === "delete") {
      const gone = matching();
      if (this.table === "conversion_report_snapshots" && gone.length) {
        return { data: null, error: { code: "23514", message: "conversion_report_snapshots are append-only" } };
      }
      this.db.tables[this.table] = rows.filter((row) => !gone.includes(row));
      return { data: null, error: null };
    }

    let found = matching();
    if (this.orderBy) {
      const column = this.orderBy;
      const sign = this.descending ? -1 : 1;
      found = [...found].sort((a, b) => sign * (Number(valueAt(a, column) ?? 0) - Number(valueAt(b, column) ?? 0)));
    }
    if (this.max != null) found = found.slice(0, this.max);
    return { data: found.map((row) => ({ ...row })), error: null };
  }
}

export class FakeTaskDb {
  tables: Record<string, Row[]>;
  /** Registro de tudo que foi inserido/atualizado, para asserções. */
  inserts: Array<{ table: string; row: Row }> = [];
  updates: Array<{ table: string; id: unknown; patch: Row }> = [];
  rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  profiles = new Map<string, string>();
  storageObjects: string[] = [];

  constructor(seed: Record<string, Row[]> = {}) {
    // As linhas semeadas passam pelo mesmo trigger de `completed_at` que uma
    // inserção real: uma etapa semeada como `aprovado` já nasce concluída.
    this.tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => this.normalize(name, { ...row }))]));
  }

  table(name: string): Row[] {
    return (this.tables[name] ??= []);
  }

  task(id: string): Row | undefined {
    return this.table("tasks").find((row) => row.id === id);
  }

  comments(id: string): Row[] {
    const payload = this.task(id)?.payload as Row | undefined;
    return Array.isArray(payload?.comments) ? (payload!.comments as Row[]) : [];
  }

  uniqueViolation(table: string, row: Row): string | null {
    const rows = this.table(table);
    if (row.id != null && rows.some((existing) => existing.id === row.id)) return `duplicate key (${table}.id)`;
    if (table === "task_links") {
      if (rows.some((existing) => existing.parent_id === row.parent_id && existing.child_id === row.child_id)) return "duplicate key (task_links parent_id, child_id)";
      if (row.workflow_step_id != null && rows.some((existing) => existing.parent_id === row.parent_id && existing.workflow_step_id === row.workflow_step_id)) {
        return "duplicate key (task_links parent_id, workflow_step_id)";
      }
    }
    if (table === "traffic_reports" && rows.some((existing) => existing.task_id === row.task_id && existing.revision === row.revision)) {
      return "duplicate key (traffic_reports task_id, revision)";
    }
    if (table === "conversion_reports" && rows.some((existing) =>
      existing.traffic_report_id === row.traffic_report_id
      && existing.feedback_task_id === row.feedback_task_id
      && String(existing.source_fingerprint ?? existing.source_comment_at ?? "") === String(row.source_fingerprint ?? row.source_comment_at ?? ""))) {
      return "duplicate key (conversion_reports traffic_report_id, feedback_task_id, source_fingerprint)";
    }
    if (table === "conversion_report_snapshots" && rows.some((existing) =>
      existing.scope_key === row.scope_key && existing.source_fingerprint === row.source_fingerprint)) {
      return "duplicate key (conversion_report_snapshots scope_key, source_fingerprint)";
    }
    return null;
  }

  normalize(table: string, row: Row): Row {
    if (row.id == null) row.id = nextId(table);
    if (table === "tasks") {
      row.payload ??= {};
      row.completed_at ??= null;
      row.status ??= "backlog";
      this.syncCompletedAt(row, null);
    }
    return row;
  }

  /** Trigger tasks_sync_completed_at. */
  private syncCompletedAt(row: Row, before: Row | null): void {
    if (TERMINAL_STATUSES.has(String(row.status))) {
      if (!before || before.status !== row.status || row.completed_at == null) row.completed_at = row.completed_at ?? new Date().toISOString();
    } else {
      row.completed_at = null;
    }
  }

  afterUpdate(table: string, row: Row, before: Row): void {
    if (table === "tasks") {
      this.syncCompletedAt(row, before);
      row.updated_at = new Date().toISOString();
      // tasks_refresh_rollup_parents: mudou o filho, o pai é reprojetado.
      if (before.status !== row.status || before.completed_at !== row.completed_at) this.refreshParentsOf(String(row.id));
    }
  }

  /** Entrega, Plano de Ação e molde recorrente: o status vem dos descendentes. */
  isProjectedParent(row: Row): boolean {
    return Boolean(row.workflow_version_id || row.recurrence_cadence || row.kind === "plano_acao");
  }

  private refreshParentsOf(childId: string): void {
    for (const link of this.table("task_links")) {
      if (link.child_id === childId && link.relation_kind === "workflow_step") this.refreshParent(String(link.parent_id));
    }
  }

  /** project_parent_status para uma Entrega versionada: o status do primeiro passo
   * ainda aberto; todos concluídos = aprovado. Escreve como o refresh do banco
   * (`north.rollup_refresh = on`), ou seja, sem passar pela recusa acima. */
  refreshParent(parentId: string): void {
    const parent = this.task(parentId);
    if (!parent?.workflow_version_id) return;
    const steps = this.table("task_links")
      .filter((link) => link.parent_id === parentId && link.relation_kind === "workflow_step")
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((link) => this.task(String(link.child_id)))
      .filter((step): step is Row => Boolean(step));
    if (!steps.length) return;
    const open = steps.find((step) => !step.completed_at);
    const next = open ? String(open.status) : "aprovado";
    if (parent.status === next) return;
    const before = { ...parent };
    parent.status = next;
    this.syncCompletedAt(parent, before);
  }

  from(table: string): Query {
    return new Query(this, table);
  }

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string) => {
        await Promise.resolve();
        this.storageObjects.push(`${bucket}/${path}`);
        return { data: { path }, error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }),
      remove: async (paths: string[]) => {
        await Promise.resolve();
        this.storageObjects = this.storageObjects.filter((object) => !paths.some((path) => object.endsWith(path)));
        return { data: null, error: null };
      },
    }),
  };

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: DbError | null }> {
    await Promise.resolve();
    this.rpcs.push({ name, args });
    if (name === "automation_task_payload_update") return this.automationPayloadUpdate(args);
    if (name === "append_task_comment_idempotent") return this.humanComment(args as unknown as HumanCommentArgs);
    if (name === "claim_automation_run") return this.claimAutomationRun(args);
    return { data: null, error: null };
  }

  /** claim_automation_run: reivindica uma vez por (config, ocorrência, ação); só
   * `failed`/`pending` (ou `running` velho) pode ser reivindicado de novo. */
  private claimAutomationRun(args: Record<string, unknown>): { data: unknown; error: DbError | null } {
    const runs = this.table("automation_runs");
    const existing = runs.find((run) => run.config_id === args.p_config_id && run.occurrence_key === args.p_occurrence_key && run.action === args.p_action);
    if (!existing) {
      const row = this.normalize("automation_runs", {
        config_id: args.p_config_id, occurrence_key: args.p_occurrence_key, action: args.p_action,
        occurrence_id: args.p_occurrence_id ?? null, scheduled_for: args.p_scheduled_for, status: "running", attempts: 1,
      });
      runs.push(row);
      return { data: [{ ...row }], error: null };
    }
    if (existing.status === "pending" || existing.status === "failed") {
      Object.assign(existing, { status: "running", attempts: Number(existing.attempts ?? 0) + 1, last_error: null });
      return { data: [{ ...existing }], error: null };
    }
    return { data: [], error: null };
  }

  private automationPayloadUpdate(args: Record<string, unknown>): { data: unknown; error: DbError | null } {
    const task = this.task(String(args.p_task_id));
    if (!task) return { data: null, error: null };
    try {
      const { payload, inserted } = applyAutomationPayloadUpdate(task.payload as Row, args as PayloadUpdateArgs, new Date().toISOString());
      task.payload = payload;
      task.updated_at = new Date().toISOString();
      return { data: { inserted, task: { ...task } }, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  }

  private humanComment(args: HumanCommentArgs): { data: unknown; error: DbError | null } {
    const task = this.task(args.p_task_id);
    if (!task) return { data: null, error: null };
    const payload = { ...((task.payload as Row) ?? {}) };
    const thread = Array.isArray(payload.comments) ? [...(payload.comments as Row[])] : [];
    if (args.p_comment_id != null && thread.some((comment) => comment.id === args.p_comment_id)) {
      return { data: { inserted: false, task: { ...task } }, error: null };
    }
    if (thread.length >= MAX_COMMENTS) return { data: null, error: null };
    thread.push({
      ...(args.p_comment_id != null ? { id: args.p_comment_id } : {}),
      author: this.profiles.get(args.p_author_id) ?? "Admin",
      author_id: args.p_author_id,
      text: args.p_text.trim(),
      at: new Date().toISOString(),
    });
    payload.comments = thread;
    task.payload = payload;
    task.updated_at = new Date().toISOString();
    return { data: { inserted: true, task: { ...task } }, error: null };
  }

  asAdmin(): AdminClient {
    return this as unknown as AdminClient;
  }
}

export function createFakeTaskDb(seed: Record<string, Row[]> = {}): FakeTaskDb {
  return new FakeTaskDb(seed);
}

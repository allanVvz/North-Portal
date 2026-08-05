const ASSIGNEE_SEPARATOR = ",";

/** The database keeps the compact, backwards-compatible text representation,
 * while every UI treats it as a real list. */
export function parseAssignees(value: string | null | undefined): string[] {
  if (!value) return [];
  const unique = new Map<string, string>();
  for (const raw of value.split(ASSIGNEE_SEPARATOR)) {
    const name = raw.trim();
    const key = name.toLocaleLowerCase("pt-BR");
    if (name && !unique.has(key)) unique.set(key, name);
  }
  return Array.from(unique.values());
}

export function formatAssignees(names: readonly string[]): string {
  return parseAssignees(names.join(ASSIGNEE_SEPARATOR)).join(", ");
}

export function assigneeOptions(values: readonly (string | null | undefined)[]): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    for (const name of parseAssignees(value)) {
      const key = name.toLocaleLowerCase("pt-BR");
      if (!names.has(key)) names.set(key, name);
    }
  }
  return Array.from(names.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Combines the legacy free-text `assignee` field with the display names of
 * any linked task_assignees accounts into the same CSV representation the
 * rest of the app already reads — so every existing consumer of
 * `TaskRecord.assignee` keeps working unchanged once accounts exist. */
export function mergeAssigneeDisplay(
  freeText: string | null | undefined,
  linkedNames: readonly (string | null | undefined)[],
): string | null {
  const linked = linkedNames.filter((name): name is string => Boolean(name?.trim()));
  const merged = formatAssignees([...parseAssignees(freeText), ...linked]);
  return merged || null;
}

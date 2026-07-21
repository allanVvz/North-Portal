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

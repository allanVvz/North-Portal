import type { DriveFile } from "./googleDrive";

const natural = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const localDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function exifTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})[:\-/](\d{2})[:\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6] ?? "00"}` : null;
}

function localTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : localDate.format(date);
}

/** Capture time wins for photos; Drive creation time covers videos and missing EXIF. */
export function driveShotTime(file: Pick<DriveFile, "captureTime" | "createdTime" | "modifiedTime">): { key: string; source: "capture" | "created" | "modified" } | null {
  const capture = exifTime(file.captureTime);
  if (capture) return { key: capture, source: "capture" };
  const created = localTime(file.createdTime);
  if (created) return { key: created, source: "created" };
  const modified = localTime(file.modifiedTime);
  return modified ? { key: modified, source: "modified" } : null;
}

export function driveShotLabel(file: Pick<DriveFile, "captureTime" | "createdTime" | "modifiedTime">): string {
  const time = driveShotTime(file);
  if (!time) return "Data não disponível";
  const [, date, clock] = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(time.key) ?? [];
  const prefix = time.source === "capture" ? "Gravado" : time.source === "created" ? "No Drive" : "Atualizado";
  return `${prefix} ${date?.slice(8, 10)}/${date?.slice(5, 7)} · ${clock}`;
}

export function isOpaqueDriveName(name: string): boolean {
  const stem = name.replace(/\.[^.]+$/, "");
  return /^[a-f0-9]{24,}$/i.test(stem) || /^[a-z0-9_-]{36,}$/i.test(stem);
}

export function driveDisplayName(file: Pick<DriveFile, "name" | "originalFilename">, fallback: string): string {
  const original = file.originalFilename?.trim();
  if (original && !isOpaqueDriveName(original)) return original;
  const name = file.name.trim();
  return name && !isOpaqueDriveName(name) ? name : fallback;
}

export function sortDriveFiles<T extends DriveFile>(files: readonly T[], order: "oldest" | "newest" = "oldest"): T[] {
  const direction = order === "oldest" ? 1 : -1;
  return [...files].sort((a, b) => {
    const aTime = driveShotTime(a)?.key;
    const bTime = driveShotTime(b)?.key;
    if (aTime && bTime && aTime !== bTime) return direction * aTime.localeCompare(bTime);
    if (aTime && !bTime) return -1;
    if (!aTime && bTime) return 1;
    return natural.compare(driveDisplayName(a, a.id), driveDisplayName(b, b.id)) || a.id.localeCompare(b.id);
  });
}

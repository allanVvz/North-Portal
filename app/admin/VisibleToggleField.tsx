"use client";

// Shared "visível para o cliente" toggle used by both TaskModal and
// TaskDetailPanel, so the two surfaces stay visually identical. Callers only
// render this at all when the platform-wide master switch (Configurações ·
// Visibilidade) is on — when it's off, the option isn't an option anywhere.
export default function VisibleToggleField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="admin-toggle vtf-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
      <span>{label}</span>
    </label>
  );
}

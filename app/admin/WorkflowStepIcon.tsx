"use client";

const paths: Record<string, React.ReactNode> = {
  roteiro: <><path d="M5 3h8l3 3v13H5z" /><path d="M13 3v4h3M8 11h5M8 14h5M8 17h3" /></>,
  captacao: <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 5-3v10l-5-3M6 3h6" /></>,
  edicao: <><path d="M4 5h16v14H4zM4 9h16M8 5v4M15 5v4M9 14l2 2 4-4" /></>,
  publicacao: <><path d="M4 13V6l13-3v14l-13-3zM4 13l3 6h3l-2-5M19 7l2 2M19 13l2-2" /></>,
  revisao: <><path d="M5 3h12v16H5zM8 8h6M8 12l2 2 4-4" /></>,
  aprovacao: <><circle cx="12" cy="11" r="8" /><path d="m8 11 3 3 5-6" /></>,
};

export default function WorkflowStepIcon({ stepKey, label }: { stepKey: string; label: string }) {
  const normalized = `${stepKey} ${label}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const kind = Object.keys(paths).find((key) => normalized.includes(key)) ?? "default";
  return (
    <span className={`tm-workflow-icon tm-workflow-icon-${kind}`} title={label} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        {paths[kind] ?? <><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></>}
      </svg>
    </span>
  );
}

"use client";

import { useRef, useState } from "react";

// Shared centered drag-and-drop entry point for both Documentos and Trilhas
// North (they're "essencialmente a mesma coisa" — same position/size, same
// upload pipeline underneath, just a different accept filter and copy).
// Picking/dropping a file doesn't upload here — it just hands the File up so
// the caller can open its existing upload modal pre-filled, reusing that
// modal's real upload pipeline instead of duplicating it.
export default function DocumentDropZone({
  label,
  hint,
  accept,
  onFileSelected,
}: {
  label: string;
  hint: string;
  accept?: string;
  onFileSelected: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFileSelected(file);
  }

  return (
    <div
      className={`doc-dropzone ${dragOver ? "over" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
    >
      <span className="doc-dropzone-ico" aria-hidden>↑</span>
      <strong>{label}</strong>
      <span className="doc-dropzone-hint">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="doc-dropzone-input"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}

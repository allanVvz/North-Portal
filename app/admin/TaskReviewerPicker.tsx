"use client";

import type { ReviewerCandidate } from "@/lib/validation";

type ReviewerSelection = {
  reviewerId: string | null;
  reviewerIds: string[];
  northAiReviewer: boolean;
};

export default function TaskReviewerPicker({
  reviewerId,
  reviewerIds,
  northAiReviewer,
  multiple,
  options,
  disabled = false,
  onChange,
}: ReviewerSelection & {
  multiple: boolean;
  options: ReviewerCandidate[];
  disabled?: boolean;
  onChange: (selection: ReviewerSelection) => void;
}) {
  const selectedHumans = multiple ? reviewerIds : reviewerId ? [reviewerId] : [];

  function updateHumans(ids: string[]) {
    onChange({ reviewerId: ids[0] ?? null, reviewerIds: ids, northAiReviewer });
  }

  return (
    <div className="task-reviewer-picker">
      {multiple ? (
        <div className="tm-reviewer-list">
          {options.map((reviewer) => <label key={reviewer.id}>
            <input type="checkbox" disabled={disabled} checked={selectedHumans.includes(reviewer.id)} onChange={(event) => updateHumans(event.target.checked
              ? [...selectedHumans, reviewer.id]
              : selectedHumans.filter((id) => id !== reviewer.id))} /> {reviewer.label}
          </label>)}
        </div>
      ) : (
        <select value={reviewerId ?? ""} disabled={disabled} aria-label="Revisor humano" onChange={(event) => updateHumans(event.target.value ? [event.target.value] : [])}>
          <option value="">— Sem revisor humano —</option>
          {options.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.label}</option>)}
        </select>
      )}
      <label className="task-reviewer-ai">
        <input type="checkbox" disabled={disabled} checked={northAiReviewer} onChange={(event) => onChange({ reviewerId, reviewerIds, northAiReviewer: event.target.checked })} /> North AI
      </label>
      {northAiReviewer && selectedHumans.length > 0 ? <small>Revisor humano tem prioridade na decisão.</small> : null}
    </div>
  );
}

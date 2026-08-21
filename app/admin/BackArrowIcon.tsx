// Shared back-arrow glyph for the circular "voltar" buttons — TaskModal's
// history-back (.tm-back, parent↔child navigation) and DocumentPreviewModal's
// floating back button reuse the exact same icon so the two read as one
// consistent affordance across the app.
export default function BackArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

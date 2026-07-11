"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// A custom horizontal scrollbar for the Kanban board, meant to live inside
// the shared fixed-height .kb-toparea slot (see KanbanBoard.tsx) — that slot,
// not this component, is what keeps the layout from shifting. So when
// scrolling isn't needed this renders nothing at all (no track, no line):
// there's no reason to show an inert bar when the outer slot already holds
// the space open.
export default function HScrollRail({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const [thumb, setThumb] = useState({ left: 0, width: 100 });
  const [needed, setNeeded] = useState(false);
  const drag = useRef<{ startX: number; startScrollLeft: number; trackWidth: number } | null>(null);

  const update = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    const overflow = scrollWidth > clientWidth + 1;
    setNeeded(overflow);
    if (!overflow) { setThumb({ left: 0, width: 100 }); return; }
    const widthPct = Math.max(8, (clientWidth / scrollWidth) * 100);
    const maxScroll = scrollWidth - clientWidth;
    const leftPct = maxScroll > 0 ? (scrollLeft / maxScroll) * (100 - widthPct) : 0;
    setThumb({ left: leftPct, width: widthPct });
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [targetRef, update]);

  function onTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = targetRef.current;
    if (!el || !needed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    el.scrollLeft = pct * (el.scrollWidth - el.clientWidth);
  }

  function onThumbPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = targetRef.current;
    if (!el) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startScrollLeft: el.scrollLeft, trackWidth: e.currentTarget.parentElement?.clientWidth ?? 1 };
  }
  function onThumbPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = targetRef.current;
    const d = drag.current;
    if (!el || !d) return;
    const scrollableWidth = el.scrollWidth - el.clientWidth;
    const trackScrollableWidth = d.trackWidth - (d.trackWidth * thumb.width) / 100;
    if (trackScrollableWidth <= 0) return;
    el.scrollLeft = d.startScrollLeft + (e.clientX - d.startX) * (scrollableWidth / trackScrollableWidth);
  }
  function onThumbPointerUp() { drag.current = null; }

  if (!needed) return null;

  return (
    <div className="kb-hrail" onClick={onTrackClick} role="scrollbar" aria-orientation="horizontal">
      <div
        className="kb-hrail-thumb"
        style={{ left: `${thumb.left}%`, width: `${thumb.width}%` }}
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerUp}
      />
    </div>
  );
}

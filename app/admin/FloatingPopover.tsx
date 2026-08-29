"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Popover que flutua de verdade: portal para o `.admin-shell` + `position: fixed`.
//
// Existe porque o padrão `absolute` + `z-index: 60` que os outros quatro
// popovers do admin usam (HeadDropdown, SortMenu, AttrVisibilityPopover,
// KanbanSearchBar) NÃO funciona dentro do modal de tarefa: `.tm` tem
// `overflow-y: auto`, então o painel é clipado pelas bordas do modal e rola
// junto com o conteúdo. É por isso que `.tm-comment-attach` já precisou de uma
// regra manual para abrir para cima — cada novo uso exigia uma exceção nova.
//
// A mecânica de posicionamento aqui é a mesma que CalendarPicker.tsx já usava e
// que este componente passa a compartilhar: medir, virar para cima quando não
// cabe embaixo, prender nas bordas da viewport, e reposicionar em resize, em
// scroll (com capture, para pegar o scroll de containers internos como `.tm`)
// e em ResizeObserver.

type Placement = "start" | "end";

export function useFloatingPopover(open: boolean, placement: Placement = "start") {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Começa escondido para não piscar na posição errada antes da primeira medição.
  const [style, setStyle] = useState({
    top: 0,
    left: 0,
    maxHeight: 10_000,
    visibility: "hidden" as "hidden" | "visible",
  });

  useLayoutEffect(() => {
    if (!open) {
      setStyle((s) => (s.visibility === "hidden" ? s : { ...s, visibility: "hidden" }));
      return;
    }
    let frame = 0;
    const position = () => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;

      const scale = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const margin = 12;
      const gap = 6;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const visualWidth = Math.min(popoverRect.width, viewportWidth - margin * 2);
      const visualHeight = Math.min(popoverRect.height, viewportHeight - margin * 2);

      // A janela horizontal é a do MODAL quando existe um, não a da viewport.
      // Sem isso um painel de 320px ancorado num botão de 20px encostado na
      // borda esquerda do card sai inteiro para fora dele e vai parar colado no
      // canto da tela — o painel abre a partir do modal, então tem que terminar
      // dentro dele.
      const boundaryRect = anchor.closest(".tm, .kb-modal")?.getBoundingClientRect() ?? null;
      const minLeft = Math.max(margin, boundaryRect ? boundaryRect.left : margin);
      const maxLeft = Math.min(
        viewportWidth - visualWidth - margin,
        boundaryRect ? boundaryRect.right - visualWidth : Number.POSITIVE_INFINITY,
      );
      const rawLeft = placement === "end" ? anchorRect.right - visualWidth : anchorRect.left;
      // Math.max(minLeft, maxLeft) porque um modal mais estreito que o painel
      // inverteria os limites e prenderia o painel no lugar errado.
      const left = Math.min(Math.max(rawLeft, minLeft), Math.max(minLeft, maxLeft));
      const spaceBelow = viewportHeight - anchorRect.bottom - gap - margin;
      const spaceAbove = anchorRect.top - gap - margin;
      const openAbove = visualHeight > spaceBelow && spaceAbove > spaceBelow;
      const top = openAbove
        ? Math.max(margin, anchorRect.top - gap - visualHeight)
        : Math.min(anchorRect.bottom + gap, viewportHeight - visualHeight - margin);

      setStyle({
        top: top / scale,
        left: left / scale,
        maxHeight: (viewportHeight - margin * 2) / scale,
        visibility: "visible",
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };

    position();
    window.addEventListener("resize", schedule);
    // capture: true — sem isso o popover não acompanha o scroll do próprio modal.
    window.addEventListener("scroll", schedule, true);
    const observer = new ResizeObserver(schedule);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (popoverRef.current) observer.observe(popoverRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, placement]);

  return { anchorRef, popoverRef, style };
}

/** Fecha em clique fora e Escape. Testa OS DOIS refs: como o popover sai por
 *  portal, ele não é descendente da âncora, e checar só a âncora fecharia o
 *  popover no primeiro clique dentro dele. */
export function useDismissOnOutside(
  open: boolean,
  onClose: () => void,
  refs: RefObject<HTMLElement | null>[],
) {
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (refs.every((ref) => !ref.current?.contains(target))) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
    // refs é estável na prática (useRef), e incluí-lo no array recriaria o
    // listener a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}

/** O conteúdo flutuante em si. Renderiza nulo no servidor e enquanto fechado. */
export function FloatingPanel({
  open,
  popoverRef,
  style,
  className,
  children,
}: {
  open: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  style: { top: number; left: number; maxHeight: number; visibility: "hidden" | "visible" };
  className: string;
  children: ReactNode;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={popoverRef} className={className} style={style}>
      {children}
    </div>,
    // `.admin-shell`, NÃO `document.body`: todos os tokens do tema
    // (`--a-surface`, `--a-border`, `--a-ink`, a fonte) são declarados naquele
    // elemento. Um portal para o body cai fora desse escopo, `var(--a-surface)`
    // não resolve e o painel sai transparente, sem borda e com a fonte errada.
    // CalendarPicker já mirava aqui pelo mesmo motivo.
    document.querySelector(".admin-shell") ?? document.body,
  );
}

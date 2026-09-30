"use client";

import { useLayoutEffect, useRef } from "react";

function resizeTextarea(element: HTMLTextAreaElement | null): void {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export default function AutoGrowTextarea({ onChange, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => resizeTextarea(ref.current), [props.value]);
  return <textarea {...props} ref={ref} onChange={(event) => { onChange?.(event); resizeTextarea(event.currentTarget); }} />;
}

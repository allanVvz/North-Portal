"use client";

import { useEffect, useState } from "react";
import { NOTIFICATION_TYPES, type NotificationType } from "./notificationTypes";

// Preferência local, por dispositivo, de quais tipos de notificação o usuário
// silenciou — mesmo mecanismo de app/admin/taskSortPrefs.ts (localStorage +
// CustomEvent + evento `storage`), para que sino, painel da Home e tela cheia
// de notificações (todos consumindo NotificationsList) nunca discordem sobre
// o que está silenciado.

const STORAGE_KEY = "admin-muted-notif-types";
const EVENT = "admin-muted-notif-types-change";

const VALID_TYPES = new Set<NotificationType>(NOTIFICATION_TYPES);

/** Descarta tipos desconhecidos/obsoletos em vez de propagar um valor
 *  quebrado — um tipo removido de NOTIFICATION_TYPES ficaria "silenciado"
 *  para sempre, sem aparecer na tela de configurações para ser reativado. */
export function sanitizeMutedTypes(raw: unknown): NotificationType[] {
  if (!Array.isArray(raw)) return [];
  const out: NotificationType[] = [];
  for (const item of raw) {
    if (VALID_TYPES.has(item as NotificationType) && !out.includes(item as NotificationType)) {
      out.push(item as NotificationType);
    }
  }
  return out;
}

function readPref(): NotificationType[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return sanitizeMutedTypes(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * O estado inicial é SEMPRE o default vazio (nenhum tipo silenciado), com a
 * leitura do localStorage num effect após montar. NotificationsList é
 * renderizado no servidor (via AdminShell/AdminHome/NotificationsScreen), e
 * um initializer lazy que lesse localStorage divergiria do HTML
 * server-rendered — mesmo erro de hidratação documentado no CLAUDE.md e já
 * evitado em taskSortPrefs.ts.
 */
export function useMutedNotificationTypes() {
  const [muted, setMutedState] = useState<Set<NotificationType>>(new Set());

  useEffect(() => {
    setMutedState(new Set(readPref()));
    function onChange() { setMutedState(new Set(readPref())); }
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  function setMuted(next: Set<NotificationType>) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch { /* localStorage indisponível: a escolha vale só nesta sessão */ }
    setMutedState(next);
    window.dispatchEvent(new Event(EVENT));
  }

  function toggle(type: NotificationType) {
    const next = new Set(muted);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setMuted(next);
  }

  return { muted, setMuted, toggle };
}

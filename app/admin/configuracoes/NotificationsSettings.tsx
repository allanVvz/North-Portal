"use client";

import { useMutedNotificationTypes } from "@/lib/notificationPrefs";
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABEL } from "@/lib/notificationTypes";

// Preferência 100% local (localStorage, ver lib/notificationPrefs.ts) — não
// existe endpoint nem coluna no banco para isso. O toggle LIGADO é o estado
// normal ("recebendo"); desligar um tipo o silencia em NotificationsList, o
// componente compartilhado pelo sino, pela Home e pela tela cheia.
export default function NotificationsSettings() {
  const { muted, toggle } = useMutedNotificationTypes();

  return (
    <div className="set-card">
      <div className="set-appearance-head">
        <div>
          <h2 className="set-h">Notificações</h2>
          <p className="admin-sub">Escolha quais tipos de notificação você quer receber no sino e na Home. Vale só neste navegador.</p>
        </div>
      </div>

      <div className="set-visibility-divider" />

      <div className="set-notif-list">
        {NOTIFICATION_TYPES.map((type) => {
          const enabled = !muted.has(type);
          return (
            <div className="set-appearance-head" key={type}>
              <div>
                <h3 className="set-h3">{NOTIFICATION_TYPE_LABEL[type]}</h3>
              </div>
              <label className="admin-toggle">
                <input type="checkbox" checked={enabled} onChange={() => toggle(type)} />
                <span className="sw" /><span>{enabled ? "Ativo" : "Silenciado"}</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

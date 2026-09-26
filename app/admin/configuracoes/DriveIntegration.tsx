import Link from "next/link";

type DriveStatus = { configured: boolean; readyClients: number; totalClients: number };

export default function DriveIntegration({ status }: { status: DriveStatus }) {
  return (
    <div className="set-card">
      <h2 className="set-h">
        Google Drive{" "}
        <span className={status.configured ? "set-badge publicada" : "set-badge"}>
          {status.configured ? "Conectado" : "Não conectado"}
        </span>
      </h2>
      <p className="admin-sub">
        O North AI prepara as pastas do Roteiro, da Captação e de cada Criativo nas diárias configuradas.
        Os arquivos colocados nessas pastas aparecem no modal de materiais dos cards.
      </p>
      <p>{status.readyClients} de {status.totalClients} clientes com pastas Raw e Edição cadastradas.</p>
      <div className="set-actions">
        <Link className="admin-btn ghost" href="/admin/clientes">Configurar pastas dos clientes</Link>
        <Link className="admin-btn ghost" href="/admin/northai/automacoes">Configurar automações</Link>
      </div>
      {!status.configured ? <p className="admin-warn">
        A conexão do Drive do servidor está pendente. As automações que criam pastas só podem ser ativadas após a conexão.
      </p> : null}
    </div>
  );
}

import { createSign } from "node:crypto";
import { HttpError } from "./validation";
import type { DriveFile } from "./googleDrive";

// Google Drive through a service account — provisioning client folders and
// listing their files for the admin preview.
//
// Plain fetch against the REST API, same shape as lib/meta.ts and lib/windsor.ts.
// The official `googleapis` SDK was tried first and pulled in type definitions
// for every Google product, pushing `tsc --noEmit` past seven minutes; signing
// the service-account JWT by hand costs ~20 lines and keeps the build fast.
//
// SERVER ONLY. Kept apart from lib/googleDrive.ts on purpose: that module is a
// pure URL parser imported by client components (CommentText, GoogleDrivePreview).
//
// The integration is optional: with the env vars absent every function returns
// null/[] instead of throwing, the toggle renders disabled, and the admin keeps
// pasting folder links by hand. A missing integration must never block creating
// a client.

const SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// Subfolders created under each client's root folder. The keys map 1:1 to the
// columns already on client_drive_links, so the automation fills exactly the
// fields a human would have pasted.
export const CLIENT_SUBFOLDERS = [
  { key: "brand", label: "Marca" },
  { key: "products", label: "Arquivos" },
  { key: "uploads", label: "Edição" },
] as const;

export type DriveFolder = { id: string; url: string };

export type DriveProvisionResult = {
  root: DriveFolder;
  brand: DriveFolder;
  products: DriveFolder;
  uploads: DriveFolder;
};

type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    // Env vars collapse real newlines, so the PEM usually arrives escaped.
    const pem = parsed.private_key.split("\\n").join("\n");
    return { client_email: parsed.client_email, private_key: pem };
  } catch {
    return null;
  }
}

function rootFolderId(): string | null {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  return id && id.trim() ? id.trim() : null;
}

/** True only when both the credentials and the parent folder are configured. */
export function isGoogleDriveConfigured(): boolean {
  return Boolean(serviceAccount() && rootFolderId());
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Access tokens last an hour; cache so a burst of calls signs once.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
  const sa = serviceAccount();
  if (!sa) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new HttpError(502, `Falha ao autenticar no Google Drive: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new HttpError(502, "Google Drive nao retornou um token de acesso.");
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

async function createFolder(token: string, name: string, parent: string): Promise<DriveFolder> {
  const res = await fetch(`${DRIVE_FILES}?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new HttpError(502, `Falha ao criar a pasta "${name}": ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new HttpError(502, `Google Drive nao retornou o id da pasta "${name}".`);
  return { id: data.id, url: folderUrl(data.id) };
}

/**
 * Creates the client's root folder plus the three standard subfolders.
 * Returns null when Drive is not configured — callers treat that as "skip",
 * never as an error. Throws only when Drive IS configured and the API refuses,
 * so the caller can surface a real failure to the admin.
 */
export async function provisionClientDriveFolders(input: {
  name: string;
  slug: string;
  shareWithEmail?: string | null;
}): Promise<DriveProvisionResult | null> {
  const parent = rootFolderId();
  if (!parent) return null;
  const token = await accessToken();
  if (!token) return null;

  const root = await createFolder(token, `${input.name} (${input.slug})`, parent);
  const [brand, products, uploads] = await Promise.all(
    CLIENT_SUBFOLDERS.map((f) => createFolder(token, f.label, root.id)),
  );

  // Sharing is best-effort: a typo'd client e-mail must not fail provisioning —
  // the folders already exist and the admin can share them by hand.
  const email = input.shareWithEmail?.trim();
  if (email) {
    try {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${root.id}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }),
        },
      );
    } catch {
      // swallowed on purpose — see comment above
    }
  }

  return { root, brand, products, uploads };
}

/** Miniatura de um arquivo do Drive, já dimensionada. */
export type DriveThumbnail = { mimeType: string; body: ArrayBuffer; contentType: string };

/**
 * A miniatura de um arquivo, para a capa do card.
 *
 * Devolve null — nunca lança — quando o Drive não está configurado, o arquivo
 * não existe, não é imagem nem vídeo, ou não tem miniatura pronta. Quem chama
 * traduz isso em 404 e o card simplesmente não mostra capa.
 *
 * Vídeo entra aqui de propósito: o `thumbnailLink` do Drive já é UM FRAME
 * renderizado pelo Google, uma imagem estática — é o preview leve que o card
 * quer, sem baixar nem decodificar vídeo nenhum.
 *
 * A miniatura é buscada e devolvida por nós, em vez de mandar o `thumbnailLink`
 * para o navegador, por dois motivos: o link é assinado e expira em algumas
 * horas (a capa apareceria e sumiria sozinha), e ele só é público quando o
 * arquivo está compartilhado — pela nossa rota, a conta de serviço enxerga
 * tudo o que já enxerga no resto da integração.
 */
/**
 * A miniatura pública de um arquivo — o endpoint que o próprio Drive usa para
 * quem abre um link compartilhado, sem API e sem credencial nenhuma.
 *
 * É o que faz a capa existir mesmo sem a conta de serviço configurada. Só
 * funciona para arquivo compartilhado como "qualquer pessoa com o link" — a
 * mesma premissa que o preview embutido do card já assume desde sempre
 * (ver lib/googleDrive.ts). Medido em produção: uma minoria dos arquivos
 * colados nos comentários passa por aqui, e é justamente por isso que o card
 * tenta vários candidatos em vez de apostar no primeiro.
 */
async function fetchPublicDriveThumbnail(fileId: string, size: number): Promise<DriveThumbnail | null> {
  try {
    const res = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}`, {
      redirect: "follow",
    });
    // Arquivo não compartilhado devolve 200/404 com uma página HTML de erro —
    // por isso o tipo importa tanto quanto o status.
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.startsWith("image/")) return null;
    return { mimeType: contentType, body: await res.arrayBuffer(), contentType };
  } catch {
    return null;
  }
}

export async function fetchDriveThumbnail(fileId: string, size = 480): Promise<DriveThumbnail | null> {
  if (!fileId) return null;
  // Sem conta de serviço, o público é a única via. Com ela, o público ainda
  // serve de rede: a conta de serviço só enxerga o que foi compartilhado com
  // ela, e um arquivo público que ela não vê continua rendendo capa.
  if (!isGoogleDriveConfigured()) return fetchPublicDriveThumbnail(fileId, size);
  try {
    const token = await accessToken();
    if (!token) return fetchPublicDriveThumbnail(fileId, size);

    const metaParams = new URLSearchParams({ fields: "mimeType,thumbnailLink", supportsAllDrives: "true" });
    const metaRes = await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?${metaParams}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Metadado inacessível = a conta de serviço não enxerga esse arquivo. Pode
    // ainda assim ser público; deixa o caminho público tentar.
    if (!metaRes.ok) return fetchPublicDriveThumbnail(fileId, size);
    const meta = (await metaRes.json()) as { mimeType?: string; thumbnailLink?: string };

    const mimeType = meta.mimeType ?? "";
    // Só imagem e vídeo viram capa. Planilha, apresentação e PDF também têm
    // miniatura no Drive, mas uma parede de miniaturas de documento não ajuda
    // a ler o quadro — ver plan/CARD-COVER-PREVIEW.md.
    //
    // Aqui NÃO há queda para o público: sabemos o tipo e a resposta é "não".
    // Cair para o público furaria justamente essa regra.
    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) return null;
    if (!meta.thumbnailLink) return fetchPublicDriveThumbnail(fileId, size);

    // O thumbnailLink termina em `=s220`. Trocar o sufixo pede a versão no
    // tamanho que a capa precisa, direto do Google — nada é redimensionado
    // aqui.
    const sized = meta.thumbnailLink.replace(/=s\d+(-c)?$/, `=s${size}`);
    const imageRes = await fetch(sized);
    if (!imageRes.ok) return fetchPublicDriveThumbnail(fileId, size);

    return {
      mimeType,
      body: await imageRes.arrayBuffer(),
      contentType: imageRes.headers.get("content-type") ?? "image/jpeg",
    };
  } catch {
    return fetchPublicDriveThumbnail(fileId, size);
  }
}

/**
 * Lists files inside a folder for the admin preview. Returns [] when Drive is
 * not configured or the folder is unreachable, so the preview degrades to an
 * empty state instead of breaking the page around it.
 */
export async function listFolderFiles(folderId: string, limit = 8): Promise<DriveFile[]> {
  if (!folderId || !isGoogleDriveConfigured()) return [];
  try {
    const token = await accessToken();
    if (!token) return [];
    const params = new URLSearchParams({
      q: `'${folderId.split("'").join("\\'")}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,thumbnailLink,webViewLink)",
      // `folder` é uma chave de ordenação do próprio Drive: põe as subpastas
      // antes dos arquivos. Importa desde que a listagem virou navegável — o
      // que se clica para descer um nível fica no topo, não perdido no meio
      // dos arquivos. Depois disso, mais recente primeiro.
      orderBy: "folder,modifiedTime desc",
      pageSize: String(Math.min(Math.max(limit, 1), 200)),
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    const res = await fetch(`${DRIVE_FILES}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      files?: { id?: string; name?: string; mimeType?: string; thumbnailLink?: string; webViewLink?: string }[];
    };
    return (data.files ?? []).map((f) => ({
      id: f.id ?? "",
      name: f.name ?? "(sem nome)",
      mimeType: f.mimeType ?? "application/octet-stream",
      thumbnailUrl: f.thumbnailLink ?? null,
      webViewLink: f.webViewLink ?? null,
    }));
  } catch {
    return [];
  }
}

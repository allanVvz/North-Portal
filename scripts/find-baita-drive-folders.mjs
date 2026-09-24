import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const envPath = process.argv[2];
const editFolderId = process.argv[3];
if (!envPath || !editFolderId) throw new Error("Uso: node scripts/find-baita-drive-folders.mjs <env> <editing-folder-id>");

const env = Object.fromEntries(readFileSync(envPath, "utf8").split(/\r?\n/).flatMap((line) => {
  const match = /^([^#=]+)=(.*)$/.exec(line);
  if (!match) return [];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return [[match[1].trim(), value.replace(/\\n/g, "\n")]];
}));
const raw = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
if (!raw) throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON ausente no arquivo consultado.");
const service = JSON.parse(raw);
const b64 = (input) => Buffer.from(input).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const claim = b64(JSON.stringify({ iss: service.client_email, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
const signer = createSign("RSA-SHA256");
signer.update(`${header}.${claim}`);
const assertion = `${header}.${claim}.${b64(signer.sign(service.private_key))}`;
const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
});
if (!tokenResponse.ok) throw new Error(`Falha OAuth: ${tokenResponse.status}`);
const token = (await tokenResponse.json()).access_token;
const headers = { Authorization: `Bearer ${token}` };
const metadataResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(editFolderId)}?fields=id,name,parents&supportsAllDrives=true`, { headers });
if (!metadataResponse.ok) throw new Error(`Pasta EDICAO inacessivel: ${metadataResponse.status}`);
const editing = await metadataResponse.json();
const parentId = editing.parents?.[0];
if (!parentId) throw new Error("A pasta EDICAO nao possui pai visivel para a conta de servico.");
const params = new URLSearchParams({
  q: `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
  fields: "files(id,name,webViewLink)", pageSize: "200", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
});
const siblingsResponse = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers });
if (!siblingsResponse.ok) throw new Error(`Falha ao listar pastas BAITA: ${siblingsResponse.status}`);
const siblings = (await siblingsResponse.json()).files ?? [];
console.log(JSON.stringify({
  parent: { id: parentId },
  editing: { id: editing.id, name: editing.name },
  candidates: siblings.filter((file) => /bruto|edi[cç][aã]o/i.test(file.name)).map(({ id, name }) => ({ id, name })),
}, null, 2));

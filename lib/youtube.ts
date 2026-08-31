// Extrai o id de 11 caracteres de uma URL do YouTube nas formas que as pessoas
// realmente colam: watch?v=, youtu.be/, /embed/, /shorts/, /live/. Devolve null
// se não for uma URL de vídeo reconhecível — o chamador decide o que fazer com
// isso (mostrar erro no formulário).

const ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeIdFromUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // Só o id, colado direto.
  if (ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return ID.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && ID.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
    if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
      return ID.test(parts[1]) ? parts[1] : null;
    }
  }

  return null;
}

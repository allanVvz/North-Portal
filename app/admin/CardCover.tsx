"use client";

import { useState } from "react";
import type { TaskCover } from "@/lib/taskCover";

// A capa do card: a miniatura do primeiro arquivo do Drive citado na descrição
// ou nos comentários (ver lib/taskCover.ts).
//
// Quatro coisas acontecem aqui, e as quatro são de propósito:
//
// 1. `loading="lazy"` — o quadro pode ter dezenas de cards. Só os que chegam
//    à tela pedem a capa.
// 2. O enquadramento é decidido DEPOIS que a imagem carrega, pela proporção
//    real: deitada é enquadrada inteira (não faz sentido cortar as laterais de
//    uma paisagem), em pé é cortada no centro (contê-la deixaria duas tarjas
//    enormes na caixa quadrada). Só o navegador sabe a proporção, então a
//    classe entra no onLoad.
// 3. Erro esconde a capa em vez de mostrar um ícone quebrado. A rota responde
//    404 para arquivo que não é imagem nem vídeo, e para Drive não
//    configurado — nesses casos o card fica exatamente como era antes de
//    existir capa.
// 4. Tudo é <span> em bloco, não <div>: o card de rotina inteiro vive dentro
//    de um <button> (OperacaoWorkspace), e <div> ali é aninhamento inválido.
//    Assim a capa é clicável junto com o resto do card nos dois quadros.
export default function CardCover({
  cover,
  title,
  /** Classe da caixa, definida pelo quadro — é ela que faz a capa sangrar até
   *  a borda do card, e cada quadro tem o seu padding. */
  className,
}: {
  cover: TaskCover;
  title: string;
  className: string;
}) {
  const [fit, setFit] = useState<"deitada" | "em-pe" | null>(null);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <span className={`card-cover ${className}${fit ? ` ${fit}` : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- rota própria que
          já devolve a miniatura no tamanho certo; o loader de otimização do
          Next não acrescentaria nada e exigiria configurar o host do Drive. */}
      <img
        src={`/api/admin/drive/thumbnail/${cover.fileId}`}
        alt={`Prévia de ${title}`}
        loading="lazy"
        decoding="async"
        onLoad={(e) => {
          const img = e.currentTarget;
          setFit(img.naturalWidth >= img.naturalHeight ? "deitada" : "em-pe");
        }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

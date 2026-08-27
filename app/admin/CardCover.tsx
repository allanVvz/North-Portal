"use client";

import { useState } from "react";
import type { TaskCover } from "@/lib/taskCover";

// A capa do card: a miniatura do primeiro arquivo do Drive que render prévia,
// entre os citados na descrição e nos comentários (ver lib/taskCover.ts).
//
// Três coisas acontecem aqui, e as três são de propósito:
//
// 1. `loading="lazy"` — o quadro pode ter dezenas de cards. Só os que chegam
//    à tela pedem a capa.
// 2. Os candidatos são tentados EM ORDEM. Nem todo arquivo do Drive rende
//    miniatura: pode não estar compartilhado, pode ter sido apagado, pode ser
//    um formato sem prévia. Medido nos dados reais, a maioria dos arquivos
//    colados nos comentários não é pública — apostar tudo no primeiro link
//    deixaria sem capa cards que têm três arquivos exibíveis logo abaixo. Cada
//    404 avança para o próximo; acabando a lista, some.
// 3. Tudo é <span> em bloco, não <div>: o card de rotina inteiro vive dentro
//    de um <button> (OperacaoWorkspace), e <div> ali é aninhamento inválido.
//    Assim a capa é clicável junto com o resto do card nos dois quadros.
//
// O enquadramento é só CSS (`object-fit: cover` em .card-cover): a imagem
// preenche a caixa quadrada e o que sobra é cortado, deitada ou em pé. Houve
// uma versão que media a proporção no onLoad para enquadrar a paisagem inteira,
// removida porque as tarjas resultantes faziam o card parecer quebrado.
export default function CardCover({
  candidates,
  title,
  /** Classe da caixa, definida pelo quadro — é ela que faz a capa sangrar até
   *  a borda do card, e cada quadro tem o seu padding. */
  className,
}: {
  candidates: TaskCover[];
  title: string;
  className: string;
}) {
  const [attempt, setAttempt] = useState(0);

  const current = candidates[attempt];
  if (!current) return null;

  return (
    <span className={`card-cover ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- rota própria que
          já devolve a miniatura no tamanho certo; o loader de otimização do
          Next não acrescentaria nada e exigiria configurar o host do Drive. */}
      <img
        // A chave força um <img> novo a cada tentativa: sem ela o React
        // reaproveita o elemento, e um src trocado depois de um erro nem sempre
        // dispara onError de novo.
        key={current.fileId}
        src={`/api/admin/drive/thumbnail/${current.fileId}`}
        alt={`Prévia de ${title}`}
        loading="lazy"
        decoding="async"
        onError={() => setAttempt((i) => i + 1)}
      />
    </span>
  );
}

// O que um comentário humano PEDE ao relatório, em vocabulário tipado.
//
// Existia só `classifyVisualComment` (lib/automations/conversionFlow.ts), que
// reconhece queixa de LAYOUT — funil sobrepondo, tabela larga, padding. Um
// pedido de CONTEÚDO não tinha representação nenhuma, e o efeito prático foi
// este comentário real da Luiza no relatório da CRIS (22/09, 19:20):
//
//   "Ajuste o comentário: Direcionamos as campanhas de trafego para perfil e
//    para o site para regiões das capitais de SC e PR também […]. Remova o
//    comentário sobre seguidores novos. e retire dos dados o % comparativo com
//    o período anterior"
//
// Três instruções. Nenhuma virou pedido: o texto inteiro caiu como "contexto"
// do relatório (com o prefixo "Ajuste o comentário:" junto), e a automação
// respondeu com uma frase pronta que não correspondia a nada do que ela pediu.
//
// Determinístico de propósito e barato: cobre como a operação escreve de fato.
// O que não casar aqui volta em `naoEntendido`, para a automação dizer no card
// que não soube fazer — em vez de ignorar em silêncio.

/** Um alvo que pode ser escondido a pedido. Nomes do vocabulário da operação,
 *  não do renderer.
 *
 *  "seguidores" NÃO entra aqui de propósito (23/09): o KPI de novos seguidores,
 *  o custo por seguidor e a etapa do funil são conteúdo estrutural da campanha
 *  de tráfego para o perfil — existem sempre que aquele objetivo existe, como
 *  "visitas ao perfil" ou "cliques no site". Tratá-los como escondíveis foi o
 *  que fez "Remova o comentário sobre seguidores novos" apagar o KPI e o funil
 *  inteiros da CRIS, quando o pedido era sobre o TEXTO no fim do relatório. */
export type HideTarget =
  | "percentual_comparativo"
  | "alcance"
  | "impressoes"
  | "cliques";

export type ReportInstruction =
  /** "Ajuste o comentário: X" — X passa a ser a leitura do período. */
  | { kind: "narrativa"; texto: string }
  /** "Remova o comentário sobre seguidores", "retire o % comparativo". */
  | { kind: "esconder"; alvo: HideTarget };

export type ExtractedInstructions = {
  instrucoes: ReportInstruction[];
  /** Trechos com cara de pedido que nenhuma regra entendeu. */
  naoEntendido: string[];
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Ajuste/atualize/troque/substitua o comentário|a análise|o texto: <resto>".
 *  O que vem depois dos dois-pontos é o texto que a pessoa quer ver no PDF. */
const NARRATIVA = /\b(?:ajust\w*|atualiz\w*|troc\w*|substitu\w*|corrij\w*|corrig\w*)\s+(?:o\s+|a\s+)?(?:coment[aá]rio|an[aá]lise|texto|leitura)\b[^:]{0,40}:\s*([\s\S]+)/i;

/** Pedidos de remoção: "remova o comentário sobre seguidores novos",
 *  "retire dos dados o % comparativo com o período anterior".
 *
 *  O escopo de cada pedido para no próximo verbo de remoção — sem isso, "retire
 *  o alcance e remova as impressões" virava um pedido só, e o segundo alvo
 *  desaparecia dentro do primeiro. */
const REMOCAO = /\b(?:remov\w*|retir\w*|tir\w*|exclu\w*|ocult\w*|esconde\w*|apagu\w*|sem)\b((?:(?!\b(?:remov\w*|retir\w*|tir\w*|exclu\w*|ocult\w*|esconde\w*|apagu\w*)\b)[^.;\n]){0,120})/gi;

const ALVOS: { alvo: HideTarget; teste: RegExp }[] = [
  { alvo: "percentual_comparativo", teste: /%|percentual|porcentagem|comparativ|compara(?:cao|tivo)|periodo anterior|semana anterior/ },
  { alvo: "alcance", teste: /alcance/ },
  { alvo: "impressoes", teste: /impress/ },
  { alvo: "cliques", teste: /clique/ },
];

/** "Remova O COMENTÁRIO sobre seguidores" fala do TEXTO no fim do relatório,
 *  não do dado. A distinção é o objeto gramatical do verbo: quando o que se
 *  pede para tirar é "o comentário"/"a análise"/"o texto", nenhum KPI e nenhuma
 *  etapa do funil saem — quem resolve isso é a narrativa (o texto novo que ela
 *  mandou entra no lugar do antigo). Sem esta regra, a palavra "seguidores"
 *  dentro da frase virava um pedido para esconder o dado, e o KPI + o funil da
 *  CRIS sumiam a cada geração (achado real, 23/09). */
const ALVO_E_TEXTO = /^\s*(?:o\s+|a\s+)?(?:coment[aá]rio|an[aá]lise|texto|leitura)\b/i;

/** Uma frase com verbo de pedido mas sem alvo reconhecido ainda é um pedido —
 *  e precisa ser dito no card, não engolido. */
const PARECE_PEDIDO = /\b(?:remov\w*|retir\w*|tir\w*|ajust\w*|corrij\w*|corrig\w*|troc\w*|substitu\w*|ocult\w*|esconde\w*|melhor\w*|arrum\w*|coloqu\w*|acrescent\w*|adicion\w*|inclu\w*)\b/i;

function limparTexto(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").replace(/^["'“”]|["'“”]$/g, "");
}

/**
 * Lê um comentário e devolve o que ele pede ao relatório.
 *
 * A narrativa é extraída primeiro e o trecho dela sai do texto antes da busca
 * por remoções: senão "Remova o comentário sobre seguidores" — que costuma vir
 * DEPOIS do texto novo, na mesma mensagem — seria lido como parte da narrativa.
 */
export function extractReportInstructions(comment: string): ExtractedInstructions {
  const instrucoes: ReportInstruction[] = [];
  const naoEntendido: string[] = [];
  const texto = (comment ?? "").trim();
  if (!texto) return { instrucoes, naoEntendido };

  let restante = texto;
  const narrativa = NARRATIVA.exec(texto);
  if (narrativa) {
    // O texto da narrativa vai até o primeiro pedido de remoção que venha depois.
    const bruto = narrativa[1];
    const corte = /\b(?:remov\w*|retir\w*|tir\w*|exclu\w*|ocult\w*|esconde\w*)\b/i.exec(bruto);
    const conteudo = limparTexto(corte ? bruto.slice(0, corte.index) : bruto);
    if (conteudo) instrucoes.push({ kind: "narrativa", texto: conteudo });
    restante = corte ? bruto.slice(corte.index) : "";
  }

  const vistos = new Set<HideTarget>();
  for (const trecho of restante.matchAll(REMOCAO)) {
    const bruto = trecho[1] ?? "";
    // Pedido sobre o TEXTO, não sobre o dado (ver ALVO_E_TEXTO). Com narrativa
    // na mesma mensagem, o pedido já está atendido — ela mandou o texto novo
    // justamente para entrar no lugar do antigo; nada a acrescentar na resposta.
    if (ALVO_E_TEXTO.test(bruto)) {
      if (!narrativa) {
        const frase = limparTexto(trecho[0]);
        if (frase.length > 3) naoEntendido.push(frase);
      }
      continue;
    }
    const escopo = fold(bruto);
    const alvo = ALVOS.find((a) => a.teste.test(escopo))?.alvo;
    if (alvo) {
      if (!vistos.has(alvo)) {
        vistos.add(alvo);
        instrucoes.push({ kind: "esconder", alvo });
      }
      continue;
    }
    const frase = limparTexto(`${trecho[0]}`);
    if (frase.length > 3) naoEntendido.push(frase);
  }

  // Nada casou, mas o texto tem cara de pedido: melhor dizer que não entendeu.
  if (!instrucoes.length && !naoEntendido.length && PARECE_PEDIDO.test(texto)) {
    naoEntendido.push(limparTexto(texto).slice(0, 160));
  }

  return { instrucoes, naoEntendido };
}

const ROTULO: Record<HideTarget, string> = {
  percentual_comparativo: "o % comparativo com o período anterior",
  alcance: "o alcance",
  impressoes: "as impressões",
  cliques: "os cliques",
};

/**
 * A resposta no card, item a item: o que foi aplicado e o que não foi.
 *
 * Substitui a frase pronta ("Relatório de conversão atualizado — crescimento de
 * seguidores reorganizado…"), que dizia sempre a mesma coisa independentemente
 * do que a pessoa tinha pedido.
 */
export function describeInstructions(extracted: ExtractedInstructions): string[] {
  const linhas: string[] = [];
  for (const instrucao of extracted.instrucoes) {
    linhas.push(instrucao.kind === "narrativa"
      ? "Troquei a leitura do período pelo texto que você escreveu."
      : `Tirei ${ROTULO[instrucao.alvo]}.`);
  }
  for (const pedido of extracted.naoEntendido) {
    linhas.push(`Não soube aplicar: "${pedido}".`);
  }
  return linhas;
}

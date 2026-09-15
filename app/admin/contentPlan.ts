// Plano de conteúdo por volume (ATA 14/09).
//
// "Para planos de conteúdo, habilitar pergunta de quantos Reels, anúncios e
// carrosséis serão planejados para o cliente, e com isso criar as ETAPAS
// agrupadas para aquele volume de entrega (para os clientes de estética
// roteirizamos o bloco de conteúdos, gravamos, editamos...)."
//
// As etapas são agrupadas pelo trabalho, não por peça: um roteiro para o bloco
// inteiro, UMA gravação para os vídeos, a edição por formato, o design dos
// carrosséis, a aprovação do cliente e a publicação. Cada etapa vira atividade
// do Plano de Ação, com data prevista contada a partir do início do plano,
// responsável e comentários próprios — editáveis na linha (StepRow).

export type ContentVolume = { reels: number; anuncios: number; carrosseis: number };

export type ContentPlanStep = {
  title: string;
  description: string;
  /** Dias a partir do início do plano. */
  offsetDays: number;
};

function count(n: number, singular: string, plural: string): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? singular : plural}`;
}

export function contentPlanSteps(volume: ContentVolume): ContentPlanStep[] {
  const reels = count(volume.reels, "Reels", "Reels");
  const anuncios = count(volume.anuncios, "anúncio", "anúncios");
  const carrosseis = count(volume.carrosseis, "carrossel", "carrosséis");
  const videos = [reels, anuncios].filter(Boolean).join(" + ");
  const everything = [reels, anuncios, carrosseis].filter(Boolean).join(" + ");
  const total = Math.max(0, volume.reels) + Math.max(0, volume.anuncios) + Math.max(0, volume.carrosseis);
  if (!total) return [];

  const steps: ContentPlanStep[] = [
    {
      title: `Roteiro do bloco — ${everything}`,
      description: `Roteirizar o bloco de conteúdos inteiro (${everything}) e revisar antes de produzir.`,
      offsetDays: 2,
    },
  ];
  if (videos) {
    steps.push({
      title: `Gravação do bloco — ${videos}`,
      description: `Uma diária de gravação para o bloco de vídeos (${videos}), com o roteiro aprovado em mãos.`,
      offsetDays: 5,
    });
  }
  if (reels) {
    steps.push({ title: `Edição — ${reels}`, description: `Editar ${reels} a partir do material gravado.`, offsetDays: 9 });
  }
  if (anuncios) {
    steps.push({ title: `Edição — ${anuncios}`, description: `Editar ${anuncios} nos formatos de mídia paga.`, offsetDays: 9 });
  }
  if (carrosseis) {
    steps.push({ title: `Design — ${carrosseis}`, description: `Diagramar ${carrosseis} a partir do roteiro aprovado.`, offsetDays: 7 });
  }
  steps.push(
    {
      title: `Aprovação do cliente — ${total} ${total === 1 ? "conteúdo" : "conteúdos"}`,
      description: `Enviar o bloco (${everything}) para o cliente aprovar e aplicar os ajustes.`,
      offsetDays: 11,
    },
    {
      title: `Publicação — ${total} ${total === 1 ? "conteúdo" : "conteúdos"}`,
      description: `Agendar e publicar o bloco aprovado (${everything}).`,
      offsetDays: 14,
    },
  );
  return steps;
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

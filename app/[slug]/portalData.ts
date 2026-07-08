// Default portal content — faithful to the "Plataforma North · Cliente | L↔D"
// Figma (node 365:3). Every section below mirrors the sample "Baita Conveniência"
// mockup. This is the fallback used whenever a client has no `client_content`
// override row; the admin can override any section per client (see lib/supabase.ts).

export type Tone = "green" | "gold" | "blue" | "purple" | "neutral";

export type PortalContent = {
  pendencias: {
    total: string;
    groups: {
      label: string;
      items: { title: string; sub: string; status: string; action: string; page?: string; icon: string }[];
    }[];
    note: string;
  };
  central: {
    plan: {
      name: string;
      price: string;
      per: string;
      status: string;
      payment: string;
      term: string;
    };
    scope: { title: string; desc: string }[];
    checkpoints: { title: string; date: string; status: string; tone: Tone }[];
    billing: {
      status: string;
      next: { label: string; date: string; amount: string };
      method: string;
      cycle: string;
      responsible: string;
    };
    invoices: { month: string; detail: string; status: string; tone: Tone }[];
  };
  acessos: {
    folders: { key: string; title: string; count: string; items: string[] }[];
  };
  time: {
    lead: { initials: string; name: string; role: string; note: string };
    members: { initials: string; name: string; role: string; desc: string; tone: Tone }[];
  };
  agenda: {
    events: { day: string; month: string; title: string; meta: string; tag: string; tone: Tone }[];
    next: { title: string; when: string; desc: string };
    calendar: { title: string; startDow: number; days: number; marks: Record<string, { tag: string; tone: Tone }> };
    legend: { label: string; tone: Tone }[];
  };
  plano: {
    title: string;
    desc: string;
    status: string;
    statusTone: Tone;
    pct: number;
    barTone: Tone;
    responsible: string;
    kanban: string;
    dateRange?: string;
    activities?: { title: string; kind: string; status: string; pct: number }[];
  }[];
  dashboard: {
    ranges: string[];
    metrics: { label: string; value: string; delta: string; tone: Tone }[];
    weekly: { label: string; value: number }[];
    weeklyTag: string;
    sources: { label: string; pct: number; tone: Tone }[];
    sourcesTotal: string;
    topContent: {
      title: string;
      meta: string;
      type: string;
      typeTone: Tone;
      reach: string;
      engage: string;
      result: string;
    }[];
  };
  home: {
    banner: { eyebrow: string; title: string; desc: string; status: string };
    heroLead: string;
    stats: { tone: Tone; value: string; unit: string; sub: string }[];
    happening: { icon: string; title: string; text: string }[];
    band: string;
  };
  trilhas: {
    items: {
      title: string;
      desc: string;
      type: "Slides" | "Vídeo" | "Guia";
      etapa: string;
      ordem: number;
      status: "Pendente" | "Em andamento" | "Concluído" | "Em breve";
      doneAt?: string;
      cta: string;
      hero?: boolean;
    }[];
  };
};

export const AVATAR_STYLES = ["#5c9088", "#cdb163", "#123a37", "#c3d3c0", "#8f7fa6"] as const;

export const defaultContent: PortalContent = {
  pendencias: {
    total: "4 pendências no total · 2 obrigatórias · 1 documento · 1 leitura — resolva para desbloquear a bússola",
    groups: [
      {
        label: "Etapas obrigatórias",
        items: [
          { title: "Manual do Cliente", sub: "Leitura pendente · 11 telas", status: "Pendente", action: "Abrir trilha", page: "trilhas", icon: "diamond" },
          { title: "Briefing", sub: "Resposta pendente · conte sobre o seu negócio", status: "Pendente", action: "Responder", page: "briefing", icon: "pencil" },
        ],
      },
      {
        label: "Documentos pendentes",
        items: [
          { title: "Acessos das plataformas", sub: "Envio pendente · logins e gerenciador", status: "Pendente", action: "Enviar", page: "acessos", icon: "key" },
        ],
      },
    ],
    note: "Só pendências aparecem aqui: documentos, leitura dos documentos, briefing e trilhas obrigatórias (como o Manual do Cliente, em Trilhas North). O andamento do contrato e do onboarding fica em Central Comercial (Checkpoints comerciais); suas atividades, agenda e reuniões ficam na bússola — esta central é apenas o que exige a sua ação.",
  },
  central: {
    plan: {
      name: "Plano Growth",
      price: "R$ 3.200",
      per: "/mês",
      status: "Ativo",
      payment: "Pagamento em dia",
      term: "Contrato vigente de 01 mai 2026 a 31 out 2026 · renovação semestral · cliente desde maio/2026",
    },
    scope: [
      { title: "Social media", desc: "Gestão de Instagram + planejamento mensal" },
      { title: "Criativos", desc: "Posts, capas de Reels e sinalização interna" },
      { title: "Campanhas de delivery", desc: "Criação e gestão de campanhas" },
      { title: "Tráfego pago básico", desc: "Meta Ads — verba a definir" },
      { title: "Organização de documentos e pastas", desc: "Estrutura no Google Drive" },
      { title: "Acompanhamento de performance", desc: "Relatórios e dashboard mensal" },
    ],
    checkpoints: [
      { title: "Assinatura de contrato", date: "01 mai 2026", status: "Concluído", tone: "green" },
      { title: "Kickoff e onboarding", date: "08 mai 2026", status: "Concluído", tone: "green" },
      { title: "Primeira revisão de resultados", date: "02 jul 2026", status: "Em andamento", tone: "gold" },
    ],
    billing: {
      status: "Em dia",
      next: { label: "Próxima fatura", date: "05 jul 2026", amount: "R$ 3.200" },
      method: "Pix / Boleto",
      cycle: "Mensal · vencimento dia 05",
      responsible: "A definir no onboarding",
    },
    invoices: [
      { month: "Junho 2026", detail: "R$ 3.200 · venc. 05/06", status: "Pago", tone: "green" },
      { month: "Maio 2026", detail: "R$ 3.200 · venc. 05/05", status: "Pago", tone: "green" },
      { month: "Julho 2026", detail: "R$ 3.200 · venc. 05/07", status: "Em aberto", tone: "gold" },
    ],
  },
  acessos: {
    folders: [
      { key: "brandUrl", title: "Identidade visual", count: "4 itens", items: ["Logo e variações", "Paleta e tipografia", "Manual de marca", "Elementos gráficos"] },
      { key: "uploadsUrl", title: "Imagens do dia a dia", count: "4 itens", items: ["Fotos do negócio", "Vídeos e bastidores", "Antes e depois", "Equipe e rotina"] },
      { key: "productsUrl", title: "Produtos & serviços", count: "4 itens", items: ["Catálogo de serviços", "Descrições e diferenciais", "Preços de referência", "Materiais de apoio"] },
    ],
  },
  time: {
    lead: { initials: "JA", name: "Júlia Antunes · Gestora de conta", role: "Ponto de contato direto", note: "Fale com a Júlia para qualquer assunto — ela coordena tudo internamente." },
    members: [
      { initials: "AM", name: "Ana Martins", role: "Designer & Social", desc: "Criativos, posts, capas de Reels e identidade visual.", tone: "gold" },
      { initials: "MR", name: "Marcos Rocha", role: "Tráfego pago", desc: "Campanhas de delivery e mídia paga no Meta.", tone: "blue" },
      { initials: "LR", name: "Lia Reis", role: "Conteúdo & Ops", desc: "Documentos, pastas, cronograma e organização.", tone: "purple" },
    ],
  },
  agenda: {
    events: [
      { day: "02", month: "JUL", title: "Reunião de alinhamento", meta: "14:00 · Google Meet", tag: "Reunião", tone: "green" },
      { day: "08", month: "JUL", title: "Entrega de criativos", meta: "Até o fim do dia", tag: "Entrega", tone: "gold" },
      { day: "15", month: "JUL", title: "Gravação de conteúdos", meta: "10:00 · Na loja", tag: "Gravação", tone: "purple" },
      { day: "30", month: "JUL", title: "Reunião de métricas do mês", meta: "15:00 · Google Meet", tag: "Reunião", tone: "green" },
    ],
    next: {
      title: "Reunião de alinhamento",
      when: "Quinta, 02 de julho · 14:00",
      desc: "Vamos revisar o plano do mês, aprovar os primeiros criativos e definir a métrica principal dos próximos 30 dias.",
    },
    calendar: {
      title: "Julho 2026",
      startDow: 3,
      days: 31,
      marks: {
        "2": { tag: "Reunião", tone: "green" },
        "3": { tag: "Post", tone: "green" },
        "7": { tag: "Post", tone: "green" },
        "8": { tag: "Entrega", tone: "gold" },
        "10": { tag: "Post", tone: "green" },
        "14": { tag: "Post", tone: "green" },
        "15": { tag: "Gravação", tone: "purple" },
        "17": { tag: "Post", tone: "green" },
        "21": { tag: "Post", tone: "green" },
        "24": { tag: "Post", tone: "green" },
        "28": { tag: "Post", tone: "green" },
        "30": { tag: "Reunião", tone: "green" },
      },
    },
    legend: [
      { label: "Reunião", tone: "green" },
      { label: "Entrega", tone: "gold" },
      { label: "Gravação", tone: "purple" },
      { label: "Post", tone: "green" },
    ],
  },
  plano: [
    { title: "Definir métrica principal dos próximos 30 dias", desc: "Escolher o indicador de sucesso que vai guiar todas as ações.", status: "Em andamento", statusTone: "green", pct: 40, barTone: "green", responsible: "AN", kanban: "Kanban · Entrada" },
    { title: "Estruturar pastas no Google Drive", desc: "Organização final de criativos, campanhas e documentos.", status: "Quase lá", statusTone: "green", pct: 80, barTone: "green", responsible: "LR", kanban: "Kanban · Publicado" },
    { title: "Primeiros criativos de Reels", desc: "Produção e aprovação das 3 capas de lançamento.", status: "Em andamento", statusTone: "gold", pct: 60, barTone: "gold", responsible: "AN", kanban: "Kanban · Em produção" },
    { title: "Plano de campanhas sazonais", desc: "Mapear datas e eventos do ano para antecipar a produção.", status: "A iniciar", statusTone: "neutral", pct: 15, barTone: "gold", responsible: "MR", kanban: "Kanban · Entrada" },
  ],
  dashboard: {
    ranges: ["7d", "30d", "90d"],
    metrics: [
      { label: "Alcance total", value: "48,2k", delta: "+18%", tone: "green" },
      { label: "Engajamento", value: "6,4%", delta: "+1,2pp", tone: "green" },
      { label: "Pedidos no delivery", value: "312", delta: "+24%", tone: "green" },
      { label: "Custo por pedido", value: "R$ 4,80", delta: "-12%", tone: "green" },
    ],
    weeklyTag: "Instagram",
    weekly: [
      { label: "Sem 1", value: 30 },
      { label: "Sem 2", value: 42 },
      { label: "Sem 3", value: 34 },
      { label: "Sem 4", value: 58 },
      { label: "Sem 5", value: 52 },
      { label: "Sem 6", value: 74 },
      { label: "Sem 7", value: 88 },
      { label: "Sem 8", value: 66 },
    ],
    sources: [
      { label: "Instagram", pct: 55, tone: "green" },
      { label: "Delivery / apps", pct: 30, tone: "gold" },
      { label: "Outros canais", pct: 15, tone: "blue" },
    ],
    sourcesTotal: "48,2k",
    topContent: [
      { title: "Reel — Combo da casa", meta: "Publicado 18 jun", type: "Reels", typeTone: "gold", reach: "14,2k", engage: "8,1%", result: "+24% pedidos" },
      { title: "Campanha delivery — Maio", meta: "Meta Ads", type: "Campanha", typeTone: "blue", reach: "11,8k", engage: "5,2%", result: "R$ 4,80/pedido" },
      { title: "Post — Mapa da conveniência", meta: "Publicado 12 jun", type: "Post", typeTone: "green", reach: "9,4k", engage: "6,7%", result: "+310 salvamentos" },
    ],
  },
  home: {
    banner: {
      eyebrow: "Etapa obrigatória · Comece por aqui",
      title: "Manual do Cliente",
      desc: "Leia o manual e responda o briefing para desbloquear a sua bússola.",
      status: "Pendente",
    },
    heroLead: "Use a bússola para navegar. Cada direção leva a uma parte da sua operação — começando pelo seu Início.",
    stats: [
      { tone: "green", value: "70%", unit: "onboarding", sub: "6 respostas pendentes" },
      { tone: "gold", value: "2", unit: "pendências", sub: "aprovações aguardando você" },
      { tone: "blue", value: "02 jul", unit: "próxima reunião", sub: "alinhamento · 14:00" },
    ],
    happening: [
      { icon: "up", title: "Onboarding", text: "70% concluído · 6 respostas pendentes" },
      { icon: "ring", title: "Aprovações", text: "2 itens aguardando sua resposta" },
      { icon: "clock", title: "Próxima reunião", text: "02 jul · 14:00 — Alinhamento mensal" },
    ],
    band: "Sua operação está em construção. A bússola aponta o caminho.",
  },
  trilhas: {
    items: [
      {
        title: "Manual do Cliente",
        desc: "Como funciona a parceria com a North, o que esperar de cada etapa e como aproveitar melhor o portal.",
        type: "Slides",
        etapa: "Jornada",
        ordem: 1,
        status: "Pendente",
        cta: "Abrir",
        hero: true,
      },
      {
        title: "Guia de Stories",
        desc: "Como criar Stories que convertem, com exemplos práticos para o seu segmento.",
        type: "Slides",
        etapa: "Conteúdo",
        ordem: 2,
        status: "Em breve",
        cta: "Em breve",
      },
    ],
  },
};

// Short sidebar labels for the 12 briefing steps (matches app/[slug]/content.ts order).
export const briefingNav = [
  "Sua história",
  "Objetivos",
  "Público-alvo",
  "Diferenciais",
  "Concorrência & refs",
  "Imagem e tom",
  "Tráfego pago",
  "Comercial",
  "Conversão",
  "Relacionamento",
  "Materiais & acessos",
  "Observações",
];

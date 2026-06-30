// Static portal content mirroring the North Figma design.
// Briefing answers are keyed by stable card keys (one answer per thematic card).

export type BriefCard = { key: string; title: string; questions: string[] };
export type BriefStep = {
  eyebrow: string;
  titleA: string;
  titleB: string;
  intro: string;
  cards: BriefCard[];
};

export const briefSteps: BriefStep[] = [
  {
    eyebrow: "Quem é a empresa",
    titleA: "Sobre o ",
    titleB: "negócio",
    intro: "Conte a origem da empresa e o que ela oferece hoje. Sem pressa: quanto mais contexto, melhor a estratégia.",
    cards: [
      {
        key: "b1_historia",
        title: "História da empresa",
        questions: [
          "Como o negócio começou?",
          "Há quanto tempo a empresa atua no mercado?",
          "Quais produtos ou serviços oferece atualmente?",
          "Qual foi a principal motivação para abrir o negócio?",
          "Como foi o processo desde a abertura até o momento atual?",
        ],
      },
      {
        key: "b1_quem",
        title: "Quem somos",
        questions: [
          "Qual é a missão atual?",
          "Qual transformação a empresa deseja gerar para seus clientes?",
          "O que faz as pessoas acompanharem, lembrarem e escolherem a marca?",
          "O que diferencia a empresa no mercado?",
          "Quem eram os fundadores antes de abrir o negócio?",
          "Quais mudanças aconteceram após a criação da empresa?",
        ],
      },
    ],
  },
  {
    eyebrow: "Objetivos com o marketing",
    titleA: "Objetivos com o ",
    titleB: "marketing",
    intro: "Onde você quer chegar — e em quanto tempo.",
    cards: [
      {
        key: "b2_metas",
        title: "Metas",
        questions: [
          "Qual é o principal objetivo com o marketing atualmente?",
          "Onde deseja ver a empresa daqui a 6 meses?",
          "Onde deseja chegar daqui a 1 ano?",
        ],
      },
    ],
  },
  {
    eyebrow: "Público-alvo",
    titleA: "Seu ",
    titleB: "público",
    intro: "Para quem falamos define como falamos.",
    cards: [
      {
        key: "b3_cliente",
        title: "Cliente ideal",
        questions: [
          "Quem é o cliente ideal da empresa?",
          "Qual serviço ou produto deve receber maior foco?",
          "Por que o cliente deve escolher a empresa e não um concorrente?",
        ],
      },
    ],
  },
  {
    eyebrow: "Diferenciais",
    titleA: "Seus ",
    titleB: "diferenciais",
    intro: "O que só a sua empresa entrega.",
    cards: [
      {
        key: "b4_dif",
        title: "Diferenciais",
        questions: [
          "O que diferencia a empresa no mercado?",
          "Quais provas, cases ou resultados sustentam isso?",
          "O que os clientes mais elogiam?",
        ],
      },
    ],
  },
  {
    eyebrow: "Concorrência e referências",
    titleA: "Mercado e ",
    titleB: "referências",
    intro: "Quem corre ao seu lado e quem te inspira.",
    cards: [
      {
        key: "b5_conc",
        title: "Concorrência",
        questions: ["Quem são os principais concorrentes?", "O que eles fazem melhor ou pior que você?"],
      },
      {
        key: "b5_ref",
        title: "Referências",
        questions: [
          "Quais perfis, empresas ou marcas são referências para vocês?",
          "O que admiram nessas referências?",
        ],
      },
    ],
  },
  {
    eyebrow: "Conteúdo, imagem e tom da marca",
    titleA: "Imagem e ",
    titleB: "tom",
    intro: "Como a marca aparece e como ela soa.",
    cards: [
      {
        key: "b6_identidade",
        title: "Identidade",
        questions: [
          "A empresa possui identidade visual?",
          "Quem irá aparecer nas gravações?",
          "Como a empresa deseja ser percebida?",
        ],
      },
      {
        key: "b6_tom",
        title: "Tom de voz",
        questions: [
          "Que tom combina com a marca (próximo, técnico, divertido)?",
          "Há temas ou palavras a evitar?",
        ],
      },
    ],
  },
  {
    eyebrow: "Tráfego pago",
    titleA: "Tráfego ",
    titleB: "pago",
    intro: "",
    cards: [
      {
        key: "b7_midia",
        title: "Mídia paga",
        questions: [
          "Qual orçamento mensal pretende direcionar para anúncios? (Considerando valor mínimo de R$ 600,00/mês — cerca de R$ 20,00 por dia.)",
          "Qual é o principal objetivo da mídia paga?",
          "Já anunciou antes? Como foi a experiência?",
        ],
      },
    ],
  },
  {
    eyebrow: "Comercial e atendimento",
    titleA: "Comercial e ",
    titleB: "atendimento",
    intro: "Como o cliente é recebido.",
    cards: [
      {
        key: "b8_atend",
        title: "Atendimento",
        questions: [
          "Quantos clientes consegue atender por dia?",
          "Liste todos os produtos e serviços oferecidos atualmente.",
        ],
      },
    ],
  },
  {
    eyebrow: "Processo comercial e conversão",
    titleA: "Processo de ",
    titleB: "conversão",
    intro: "Do primeiro contato ao fechamento.",
    cards: [
      {
        key: "b9_etapas",
        title: "Etapas",
        questions: [
          "Quais são as etapas comerciais do primeiro contato ao fechamento?",
          "Quanto tempo o cliente costuma levar para fechar?",
        ],
      },
      {
        key: "b9_ofertas",
        title: "Objeções e ofertas",
        questions: ["Quais são as principais objeções dos leads?", "A empresa realiza promoções?"],
      },
    ],
  },
  {
    eyebrow: "Organização e relacionamento",
    titleA: "Organização e ",
    titleB: "relacionamento",
    intro: "O que acontece depois da venda.",
    cards: [
      {
        key: "b10_rel",
        title: "Relacionamento",
        questions: [
          "Vocês realizam follow-up dos leads?",
          "Existe um processo de pós-venda?",
          "Há planos de lançar novos produtos ou serviços nos próximos 3 meses?",
        ],
      },
    ],
  },
  {
    eyebrow: "Materiais e acessos necessários",
    titleA: "Materiais e ",
    titleB: "acessos",
    intro: "O que precisamos em mãos para começar.",
    cards: [
      {
        key: "b11_midias",
        title: "Fotos e mídias",
        questions: ["Cole o link do Drive com as fotos e vídeos que você já tem (pasta compartilhada)."],
      },
      {
        key: "b11_insta",
        title: "Acesso ao Instagram",
        questions: ["Login e senha do Instagram para publicação."],
      },
      {
        key: "b11_meta",
        title: "Gerenciador do Meta",
        questions: [
          "Você sabe incluir um e-mail no Gerenciador de Anúncios do Meta? Se não souber, marcamos uma call para fazer isso juntos.",
        ],
      },
    ],
  },
  {
    eyebrow: "Observações finais",
    titleA: "Observações ",
    titleB: "finais",
    intro: "",
    cards: [
      {
        key: "b12_obs",
        title: "Para fechar",
        questions: [
          "Existe alguma informação importante que ainda não foi abordada?",
          "Datas importantes (aniversário da empresa, equipe)?",
        ],
      },
    ],
  },
];

// ---- Manual sub-pages ----
export const checklistItems = [
  "Contrato assinado",
  "Pagamento confirmado",
  "Briefing respondido",
  "Acesso ao Gerenciador de Anúncios",
  "Fotos e vídeos do negócio",
  "Logins das redes sociais",
  "Identidade visual",
  "Admin da página do Facebook",
];

export const comoFunciona = [
  { num: "01", title: "Imersão", text: "Mergulhamos no seu negócio. Quanto mais completo o briefing, mais certeira fica a estratégia." },
  { num: "02", title: "Alinhamento", text: "Encontros de alinhamento e apresentação prévia dos roteiros, antes de qualquer gravação." },
  { num: "03", title: "Entrega", text: "Os conteúdos chegam via Google Drive e WhatsApp para a sua aprovação." },
];

export const cronograma = [
  { week: "S0", text: "Briefing e acessos às redes sociais." },
  { week: "S1", text: "Kickoff, roteirização, gravação e início das campanhas de perfil." },
  { week: "S2", text: "Edição e início das campanhas para WhatsApp." },
  { week: "S3", text: "Publicação dos conteúdos aprovados." },
  { week: "S4", text: "Reunião de métricas e ajustes do primeiro mês." },
];

export const recomendacoes = [
  { num: "01", title: "Rotina de Stories", text: "Mostre o serviço por dentro com frequência — o bastidor aproxima e converte." },
  { num: "02", title: "Planilha em dia", text: "Preencha diariamente a planilha de acompanhamento. Dado registrado é decisão mais rápida." },
  { num: "03", title: "Presença na comunidade", text: "Use o grupo de WhatsApp e participe dos encontros. A parceria funciona em via dupla." },
];

export const deveresNorth = [
  "Planejamento e produção dos posts",
  "Gravação dos conteúdos",
  "Legendas e copy",
  "Criativos para anúncios",
  "Gestão de tráfego pago",
  "Relatórios de desempenho",
  "Aprovações e alterações",
];
export const deveresCliente = [
  "Acessos às plataformas",
  "Número de WhatsApp dedicado",
  "Preenchimento das planilhas",
  "Envio de materiais e fotos",
  "Presença em reuniões e gravações",
  "Organização dos serviços a gravar",
];

// ---- Marca & Produtos folders (mapped to drive links) ----
export type FolderKey = "brandUrl" | "uploadsUrl" | "productsUrl";
export const folders: { key: FolderKey; title: string; items: string[] }[] = [
  { key: "brandUrl", title: "Identidade visual", items: ["Logo e variações", "Paleta e tipografia", "Manual de marca", "Elementos gráficos"] },
  { key: "uploadsUrl", title: "Imagens do dia a dia", items: ["Fotos do negócio", "Vídeos e bastidores", "Antes e depois", "Equipe e rotina"] },
  { key: "productsUrl", title: "Produtos & serviços", items: ["Catálogo de serviços", "Descrições e diferenciais", "Preços de referência", "Materiais de apoio"] },
];

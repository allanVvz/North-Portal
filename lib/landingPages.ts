// Registro estático das landing pages públicas do sistema, usado pela tela
// de Configurações > Landing Pages. Hoje é só uma lista em código — não há
// tabela nem CRUD; quando uma nova landing page for criada, adicione uma
// entrada aqui.
export type LandingPageDef = {
  slug: string;
  path: string;
  title: string;
  description: string;
};

export const LANDING_PAGES: LandingPageDef[] = [
  {
    slug: "lp",
    path: "/lp",
    title: "Diagnóstico gratuito",
    description: "Home redesenhada para negócios locais premium, com formulário de captura de lead que direciona a conversa para o WhatsApp.",
  },
];

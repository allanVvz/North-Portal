# Tipos de cliente & dados de demonstração

> **Objetivo:** definir **quem** usa o Portal North e **com o que** preencher para uma demonstração convincente. Todos os dados abaixo são fictícios/ilustrativos e prontos para inserir.
> Referências técnicas: `docs/REQUISITOS-PORTAL-NORTH.md` (modelo de dados/API) e `app/[slug]/content.ts` (chaves do briefing).

## 1. Quem são os clientes

O Portal North é usado pelos **clientes da agência North** — negócios locais que contratam marketing de conteúdo + tráfego pago. Cada cliente recebe um portal em `/[slug]` para: responder o briefing, acessar materiais (Drive) e acompanhar resultados.

### Arquétipos (nichos que já aparecem no produto/design)

| Arquétipo | Exemplo | Slug sugerido | Características de conteúdo |
|---|---|---|---|
| **Estética automotiva / detailing** | Karpinski Detalhamento | `karpinski` | Bastidores de serviço, antes/depois, stories → orçamento no Direct. Guia de Stories aplicável. |
| **Conveniência / varejo de bairro** | Baita Conveniência | `baita-conveniencia` | Delivery, combos, sinalização, campanhas por bairro, ticket médio. |
| **Food & bebidas / bar** | (ex.) Tock Fatal | `tock-fatal` | Eventos, cardápio, agenda semanal, público noturno. |
| **Serviços locais** (clínicas, pet, beleza) | genérico | `cliente-exemplo` | Agendamentos, autoridade, prova social, captação de leads. |
| **A própria agência (conta-mãe)** | ADM NORTH | `north` | Conta de demonstração/administração. Slug inicial. |

### Perfil de uso (o que cada cliente faz no portal)
1. **Onboarding**: lê o Manual do Cliente + Guia de Stories, responde o **briefing** (12 seções).
2. **Materiais**: acessa os 3 links de Drive (marca, produtos, uploads).
3. **Resultados**: vê até 4 métricas, insights, relatório e envia feedback.
4. **North (agência)**: preenche resultados/links via rota admin.

---

## 2. O que preencher para uma demonstração

Para uma demo crível, cada cliente-demo precisa de **4 blocos** de dados (tabelas `clients`, `briefing_answers`, `client_drive_links`, `client_results`):

1. **Identidade** — `name` + `slug` + `is_active=true`.
2. **Briefing** — respostas por **chave de card** (não por pergunta). Chaves válidas (de `content.ts`):
   `b1_historia, b1_quem, b2_metas, b3_cliente, b4_dif, b5_conc, b5_ref, b6_identidade, b6_tom, b7_midia, b8_atend, b9_etapas, b9_ofertas, b10_rel, b11_midias, b11_insta, b11_meta, b12_obs`.
3. **Links de Drive** — `brandUrl`, `productsUrl`, `uploadsUrl` (HTTPS, abrir em nova aba).
4. **Resultados** — `topMetrics` (**máx. 4**), `insights[]`, `reportUrl`, `feedbackUrl`.

> Dica de demo: preencher o briefing **parcialmente** (algumas seções respondidas, outras pendentes) mostra melhor os estados "Salvo/Pendente/Concluído" e a central de pendências.

---

## 3. Cliente-demo pronto: **Karpinski** (estética automotiva)

### 3.1 Briefing (`answers` — colar em `briefing_answers.answers`)
```json
{
  "b1_historia": "A Karpinski nasceu em 2019 como uma garagem de detailing e cresceu para um estúdio completo de estética automotiva. Começou com polimento e hoje faz vitrificação, higienização e proteção de pintura.",
  "b1_quem": "Missão: devolver o brilho de fábrica e proteger o patrimônio do cliente. Somos reconhecidos pelo acabamento premium e pelo atendimento consultivo.",
  "b2_metas": "Objetivo: aumentar orçamentos via Direct. 6 meses: dobrar agendamentos de vitrificação. 1 ano: virar referência de detailing na região.",
  "b3_cliente": "Cliente ideal: dono de carro seminovo/premium que valoriza conservação. Foco em vitrificação e polimento técnico.",
  "b4_dif": "Diferenciais: produtos importados, box climatizado e garantia de 1 ano na vitrificação. Clientes elogiam o antes/depois e a durabilidade.",
  "b6_tom": "Tom próximo e técnico ao mesmo tempo; nada exagerado. Evitar promessas irreais.",
  "b7_midia": "Orçamento inicial de R$ 900/mês. Objetivo: leads qualificados de polimento e vitrificação. Já anunciou pouco, sem estratégia.",
  "b11_insta": "Login e senha a enviar pelo canal seguro.",
  "b12_obs": "Aniversário da empresa em setembro — boa data para campanha."
}
```

### 3.2 Admin PATCH (links + resultados)
```bash
curl -X PATCH "$BASE/api/admin/client/karpinski" \
  -H "Authorization: Bearer $NORTH_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Karpinski Detalhamento",
    "is_active": true,
    "brandUrl": "https://drive.google.com/drive/folders/DEMO-marca-karpinski",
    "productsUrl": "https://drive.google.com/drive/folders/DEMO-servicos-karpinski",
    "uploadsUrl": "https://drive.google.com/drive/folders/DEMO-uploads-karpinski",
    "topMetrics": [
      { "label": "Orçamentos no Direct", "value": "63", "variation": "+41%", "description": "Últimos 30 dias" },
      { "label": "Alcance", "value": "48,2 mil", "variation": "+12%", "description": "Contas alcançadas" },
      { "label": "Custo por lead", "value": "R$ 7,80", "variation": "-23%", "description": "Meta Ads" },
      { "label": "Agendamentos", "value": "29", "variation": "+18%", "description": "Vitrificação/polimento" }
    ],
    "insights": [
      { "title": "Stories de bastidor convertem mais", "description": "Sequências mostrando o processo geraram 2x mais DMs que posts de resultado isolado.", "category": "Conteúdo", "date": "2026-06-28" },
      { "title": "Sexta é o dia comercial", "description": "Ofertas de vitrificação na sexta tiveram o melhor CTR da semana.", "category": "Mídia", "date": "2026-06-25" }
    ],
    "reportUrl": "https://drive.google.com/file/d/DEMO-relatorio-karpinski",
    "feedbackUrl": "https://forms.gle/DEMO-feedback-karpinski"
  }'
```

---

## 4. Cliente-demo pronto: **Baita Conveniência** (varejo/delivery)

### 4.1 Briefing (parcial — mostra pendências)
```json
{
  "b1_historia": "A Baita nasceu como uma conveniência de bairro e cresceu virando ponto de encontro: bar, eventos e uma operação forte de delivery.",
  "b2_metas": "Objetivo: crescer o delivery próprio e reduzir dependência de apps. 6 meses: +30% de pedidos diretos.",
  "b3_cliente": "Público do bairro, 20–45 anos, que pede à noite e nos fins de semana. Combos e bebidas geladas.",
  "b8_atend": "Atende ~120 pedidos/dia no pico. Produtos: combos, bebidas, tabacaria, snacks."
}
```

### 4.2 Admin PATCH
```bash
curl -X PATCH "$BASE/api/admin/client/baita-conveniencia" \
  -H "Authorization: Bearer $NORTH_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Baita Conveniência",
    "is_active": true,
    "brandUrl": "https://drive.google.com/drive/folders/DEMO-marca-baita",
    "productsUrl": "https://drive.google.com/drive/folders/DEMO-combos-baita",
    "uploadsUrl": "https://drive.google.com/drive/folders/DEMO-uploads-baita",
    "topMetrics": [
      { "label": "Pedidos diretos", "value": "1.240", "variation": "+142%", "description": "Delivery próprio" },
      { "label": "Ticket médio", "value": "R$ 58", "variation": "+9%" },
      { "label": "ROI de mídia", "value": "4,3x", "variation": "+0,6x" }
    ],
    "insights": [
      { "title": "Combos por bairro", "description": "Segmentar campanhas por bairro reduziu o custo por pedido.", "category": "Meta Ads" }
    ],
    "reportUrl": "https://drive.google.com/file/d/DEMO-relatorio-baita",
    "feedbackUrl": "https://forms.gle/DEMO-feedback-baita"
  }'
```

---

## 5. Conta-mãe: **ADM NORTH** (`/north`)
- `name`: `ADM NORTH` · `slug`: `north` · `is_active: true` (slug inicial, alvo do redirect de `/`).
- Briefing pode ficar **vazio** (demonstra estado "não iniciado") ou com 1–2 seções.
- Resultados podem ficar vazios (demonstra estados vazios) ou com dados de vitrine.

---

## 6. Inserção no banco (pré-requisito)

Como **não há endpoint de criação** hoje (ver Dúvidas #4), crie os registros no Supabase (SQL Editor) **antes** de rodar os `curl` admin:

```sql
-- para cada cliente-demo:
with c as (
  insert into public.clients (slug, name, is_active)
  values ('karpinski', 'Karpinski Detalhamento', true)
  on conflict (slug) do update set name = excluded.name, is_active = true
  returning id
)
insert into public.briefing_answers (client_id, answers, submitted)
  select id, '{}'::jsonb, false from c
  on conflict (client_id) do nothing;
-- repetir inserts vazios em client_drive_links e client_results (on conflict do nothing)
insert into public.client_drive_links (client_id) select id from public.clients where slug='karpinski'
  on conflict (client_id) do nothing;
insert into public.client_results (client_id) select id from public.clients where slug='karpinski'
  on conflict (client_id) do nothing;
```

Depois: rode o `curl` admin (seção 3.2/4.2) para preencher links/resultados, e cole o `answers` do briefing (seção 3.1) via SQL `update public.briefing_answers set answers = '<json>' where client_id = (select id from clients where slug='karpinski');` **ou** pela própria tela de briefing do portal.

> `BASE` = URL do deploy (ex.: `https://north-portal-navy.vercel.app`) ou `http://localhost:3000` em dev.

---

## 7. Roteiro sugerido de demonstração (5 min)

1. Abrir `/karpinski` → portal carrega com nome e resultados reais.
2. Ir ao **briefing** → mostrar autosave (chip "Salvo"), responder uma seção pendente.
3. Abrir **materiais** (Drive) e **resultados** (4 métricas + insights).
4. Abrir `/baita-conveniencia` → mostrar **isolamento** (dados totalmente diferentes pelo mesmo código).
5. Abrir `/slug-inexistente` → **404 amigável**; mencionar cliente inativo (`is_active=false`) fecha o portal.
6. (Técnico) mostrar 1 `curl` admin atualizando uma métrica e recarregar o portal.

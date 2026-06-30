# Regras de Negócio — Portal North

## 1. Objetivo do sistema

O Portal North é uma aplicação web multi-cliente baseada em **slug**, usada para:

1. disponibilizar um portal exclusivo para cada cliente;
2. coletar e salvar o briefing do cliente;
3. exibir links de materiais de marca e produtos;
4. disponibilizar links de envio de arquivos;
5. apresentar resultados, métricas, insights, relatórios e feedback;
6. manter os dados persistentes no Supabase;
7. hospedar o frontend e as funções de servidor na Vercel.

O sistema não terá backend tradicional, VPS ou servidor dedicado.

---

## 2. Princípio de identificação por slug

Cada cliente possui um `slug` único.

Exemplos:

```text
north
cliente-exemplo
tock-fatal
baita-conveniencia
```

O slug é usado para:

- identificar o cliente na URL;
- consultar os dados corretos no Supabase;
- carregar o briefing;
- carregar os links de marca e produtos;
- carregar métricas, insights, relatório e feedback;
- salvar alterações no registro correto.

### 2.1 Formato válido do slug

O slug deve:

- conter apenas letras minúsculas;
- permitir números;
- permitir hífen entre palavras;
- não conter espaços;
- não conter acentos;
- não conter caracteres especiais;
- ser único no banco.

Expressão regular:

```regex
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

### 2.2 Cliente inicial

```text
Nome: ADM NORTH
Slug: north
Rota: /north
```

---

## 3. Rotas públicas

### 3.1 Rota raiz

```text
/
```

Regras:

- redirecionar para `/north`;
- não exibir um portal genérico sem cliente;
- não criar um cliente automaticamente.

### 3.2 Portal do cliente

```text
/[slug]
```

Exemplos:

```text
/north
/tock-fatal
/baita-conveniencia
```

Essa rota deve:

1. validar o slug;
2. localizar o cliente no banco;
3. confirmar que o cliente está ativo;
4. carregar os dados do portal;
5. mostrar o conteúdo correspondente ao slug.

### 3.3 Slug inexistente

Quando o slug não existir:

- retornar página 404;
- não criar um cliente automaticamente;
- não mostrar dados de outro cliente;
- não usar `north` como fallback;
- exibir mensagem amigável.

### 3.4 Cliente inativo

Quando `is_active = false`:

- bloquear o carregamento do portal;
- não exibir briefing, links ou resultados;
- mostrar uma mensagem de portal indisponível;
- preservar os dados no banco.

---

## 4. Entidades e tabelas

## 4.1 `clients`

Cadastro principal do cliente.

| Campo | Tipo | Regra |
|---|---|---|
| `id` | UUID | Chave primária interna |
| `slug` | text | Obrigatório, único e válido |
| `name` | text | Nome exibido no portal |
| `is_active` | boolean | Define se o portal pode ser acessado |
| `created_at` | timestamptz | Preenchido automaticamente |
| `updated_at` | timestamptz | Atualizado automaticamente |

Regras:

- um slug pertence a apenas um cliente;
- o slug não deve mudar sem ação administrativa;
- alterar o slug muda a URL pública;
- os registros relacionados permanecem ligados pelo `client_id`;
- o frontend nunca deve depender do UUID na URL.

---

## 4.2 `briefing_answers`

Armazena as respostas atuais do briefing.

| Campo | Tipo | Regra |
|---|---|---|
| `id` | UUID | Chave primária |
| `client_id` | UUID | Referência ao cliente |
| `answers` | JSONB | Respostas atuais |
| `submitted` | boolean | Indica conclusão |
| `updated_at` | timestamptz | Última alteração |

Regras:

- cada cliente possui apenas um registro de briefing;
- as respostas são permanentes;
- alterações substituem o estado atual;
- não existe versionamento;
- não existe histórico de respostas;
- recarregar a página deve restaurar as respostas;
- respostas de um slug nunca podem alterar outro cliente;
- concluir o briefing não deve apagar nem duplicar respostas.

### Estrutura recomendada

```json
{
  "company_origin": "A empresa começou...",
  "current_services": "Serviço A, Serviço B",
  "marketing_goal": "Aumentar vendas",
  "target_audience": "Empresas da região",
  "brand_tone": "Profissional e próxima"
}
```

Cada pergunta deve possuir uma chave estável. O texto completo da pergunta não deve ser usado como identificador técnico.

---

## 4.3 `client_drive_links`

Armazena os três links externos do cliente.

| Campo | Tipo | Regra |
|---|---|---|
| `id` | UUID | Chave primária |
| `client_id` | UUID | Um registro por cliente |
| `brand_url` | text | Materiais da marca |
| `products_url` | text | Produtos e ofertas |
| `uploads_url` | text | Envio de arquivos |
| `updated_at` | timestamptz | Última alteração |

### Links do módulo Marca e Produtos

1. **Materiais da marca** — `brand_url`
2. **Produtos e ofertas** — `products_url`
3. **Enviar arquivos** — `uploads_url`

Regras:

- os links são cadastrados por administradores;
- trocar o slug muda o cliente consultado;
- nenhum link pode ficar fixo no frontend;
- links vazios devem ser ocultados ou desabilitados;
- links externos abrem em nova aba;
- usar `rel="noopener noreferrer"`;
- aceitar somente URLs HTTPS;
- nesta versão, o upload é feito por Drive ou serviço externo.

---

## 4.4 `client_results`

Armazena resultados e métricas do cliente.

| Campo | Tipo | Regra |
|---|---|---|
| `id` | UUID | Chave primária |
| `client_id` | UUID | Um registro por cliente |
| `insights` | JSONB | Lista de insights |
| `top_metrics` | JSONB | Até quatro métricas |
| `report_url` | text | Relatório completo |
| `feedback_url` | text | Formulário de feedback |
| `updated_at` | timestamptz | Última atualização |

### Métricas superiores

Formato:

```json
[
  {
    "label": "Leads",
    "value": "128",
    "variation": "+18%",
    "description": "Leads gerados no período"
  }
]
```

Regras:

- exibir no máximo quatro itens;
- não inventar métricas;
- não mostrar números fictícios;
- a ordem do JSON define a ordem visual;
- métricas vazias geram estado sem dados.

### Insights

Formato:

```json
[
  {
    "title": "Melhor campanha do período",
    "description": "A campanha de remarketing teve o menor custo por lead.",
    "category": "Meta Ads",
    "date": "2026-06-24"
  }
]
```

Regras:

- exibir todos os insights cadastrados;
- manter a ordem recebida;
- categoria e data são opcionais;
- quando vazio, mostrar “Nenhum insight publicado”.

### Relatório

Campo: `report_url`

- botão: **Abrir relatório completo**;
- abrir em nova aba;
- ocultar ou desabilitar quando não houver link;
- variar conforme o slug.

### Feedback

Campo: `feedback_url`

- botão: **Enviar feedback**;
- abrir em nova aba;
- ocultar ou desabilitar quando não houver link;
- variar conforme o slug.

---

## 5. Relações

```text
clients
  ├── briefing_answers
  ├── client_drive_links
  └── client_results
```

```text
clients.id = briefing_answers.client_id
clients.id = client_drive_links.client_id
clients.id = client_results.client_id
```

Cardinalidade:

```text
1 cliente → 1 briefing atual
1 cliente → 1 conjunto de links
1 cliente → 1 conjunto de resultados
```

---

## 6. Fluxo de carregamento

Ao abrir `/[slug]`:

```text
1. Validar o slug
2. Consultar clients
3. Confirmar is_active = true
4. Carregar briefing_answers
5. Carregar client_drive_links
6. Carregar client_results
7. Normalizar valores nulos
8. Renderizar o portal
```

Resposta esperada da API:

```json
{
  "client": {
    "slug": "north",
    "name": "ADM NORTH"
  },
  "briefing": {
    "answers": {},
    "submitted": false,
    "updatedAt": null
  },
  "driveLinks": {
    "brandUrl": null,
    "productsUrl": null,
    "uploadsUrl": null
  },
  "results": {
    "insights": [],
    "topMetrics": [],
    "reportUrl": null,
    "feedbackUrl": null
  }
}
```

---

## 7. Rotas de API

## 7.1 Consultar portal

```http
GET /api/client/[slug]
```

Responsabilidades:

- validar slug;
- localizar cliente ativo;
- retornar somente dados necessários;
- não expor chaves privadas;
- não retornar dados de outros clientes;
- retornar 404 para slug inexistente;
- retornar 403 ou 404 para cliente inativo.

---

## 7.2 Salvar briefing

```http
PATCH /api/client/[slug]/briefing
```

Payload:

```json
{
  "answers": {
    "question_key": "Resposta"
  },
  "submitted": false
}
```

Responsabilidades:

- validar slug;
- validar payload;
- limitar tamanho das respostas;
- localizar o cliente pelo slug;
- atualizar apenas o briefing correspondente;
- não criar versão;
- não criar histórico;
- atualizar `updated_at`;
- retornar o estado salvo.

Resposta:

```json
{
  "answers": {
    "question_key": "Resposta"
  },
  "submitted": false,
  "updatedAt": "2026-06-24T05:00:00Z"
}
```

---

## 7.3 Atualização administrativa

```http
PATCH /api/admin/client/[slug]
```

Campos permitidos:

```text
name
isActive
brandUrl
productsUrl
uploadsUrl
insights
topMetrics
reportUrl
feedbackUrl
```

Proteção:

```http
Authorization: Bearer <NORTH_ADMIN_TOKEN>
```

Regras:

- token ausente: `401`;
- token inválido: `401`;
- slug inexistente: `404`;
- payload inválido: `400`;
- não permitir alterar UUIDs;
- não permitir campos desconhecidos;
- não registrar segredos em logs.

---

## 8. Salvamento automático

O briefing deve salvar automaticamente.

Regras:

- debounce entre 800 e 1200 ms;
- não enviar requisição a cada tecla;
- exibir status de salvamento;
- não apagar respostas anteriores;
- a última edição válida prevalece;
- evitar race conditions;
- ignorar respostas antigas de requisições atrasadas;
- salvar antes de marcar como concluído.

Estados:

```text
Não salvo
Salvando...
Salvo
Erro ao salvar
Concluído
```

### Conclusão

Ao concluir:

```json
{
  "submitted": true
}
```

Regras:

- manter as respostas editáveis;
- não criar nova versão;
- não duplicar o registro;
- permitir que o administrador identifique a conclusão.

---

## 9. Isolamento multi-cliente

O sistema é multi-cliente por slug.

```text
/north
/cliente-a
/cliente-b
```

Fluxo interno:

```text
clients.slug = slug da URL
        ↓
clients.id
        ↓
briefing_answers.client_id
client_drive_links.client_id
client_results.client_id
```

Regras:

- `/north` nunca pode receber dados de `/cliente-a`;
- o slug da URL é a referência pública;
- o UUID é a referência interna;
- o navegador não deve enviar `client_id` para escolher o registro;
- o servidor resolve o `client_id` a partir do slug;
- o frontend não deve usar um cliente global fixo.

---

## 10. Cadastro de novo cliente

Fluxo administrativo:

```text
1. Definir nome
2. Definir slug
3. Criar registro em clients
4. Criar briefing_answers vazio
5. Criar client_drive_links vazio
6. Criar client_results vazio
7. Preencher links e resultados
8. Ativar o cliente
```

Exemplo:

```json
{
  "name": "Cliente Exemplo",
  "slug": "cliente-exemplo",
  "isActive": true
}
```

URL gerada:

```text
https://dominio.vercel.app/cliente-exemplo
```

---

## 11. Alteração de slug

Quando o slug mudar:

- a URL pública muda;
- os dados vinculados ao `client_id` permanecem;
- a URL antiga deixa de funcionar;
- não duplicar o cliente;
- não criar novos registros relacionados;
- validar conflito com outro slug;
- considerar redirecionamento quando a URL anterior já tiver sido divulgada.

---

## 12. Desativação e exclusão

### Desativação recomendada

```text
is_active = false
```

Efeito:

- portal deixa de abrir;
- dados permanecem;
- cliente pode ser reativado.

### Exclusão definitiva

Somente por ação administrativa explícita.

Efeito:

- excluir cliente;
- excluir briefing;
- excluir links;
- excluir resultados;
- respeitar `ON DELETE CASCADE`;
- exigir confirmação.

---

## 13. Segurança

Regras obrigatórias:

- nunca expor `SUPABASE_SERVICE_ROLE_KEY`;
- operações de escrita passam por rota de servidor;
- frontend usa apenas chave publicável;
- não confiar no slug sem validação;
- não aceitar `client_id` vindo do navegador;
- limitar tamanho do JSON do briefing;
- validar URLs externas;
- proteger rotas administrativas;
- não registrar tokens em logs;
- não retornar stack trace ao cliente;
- utilizar HTTPS;
- revisar políticas RLS;
- evitar escrita anônima irrestrita.

---

## 14. Estados vazios

### Briefing vazio

```text
Seu briefing ainda não foi iniciado.
```

### Link não cadastrado

```text
Este material ainda não está disponível.
```

### Métricas vazias

```text
Os resultados ainda não foram publicados.
```

### Insights vazios

```text
Nenhum insight publicado até o momento.
```

### Erro de carregamento

```text
Não foi possível carregar o portal agora. Tente novamente.
```

### Erro de salvamento

```text
Não foi possível salvar sua resposta. Verifique sua conexão e tente novamente.
```

---

## 15. Cache

- briefing não deve usar cache longo;
- respostas salvas devem aparecer imediatamente;
- APIs de escrita usam `no-store`;
- links e resultados podem usar revalidação curta;
- mudança de slug deve invalidar o conteúdo anterior;
- dados de um slug nunca devem ser reutilizados em outro.

---

## 16. Critérios de aceite

- `/` redireciona para `/north`;
- `/north` carrega ADM NORTH;
- slug inválido retorna erro;
- slug inexistente retorna 404;
- briefing salva por slug;
- respostas persistem após recarregar;
- não existe versionamento;
- cada cliente possui dados isolados;
- os três links são carregados do banco;
- métricas são carregadas do banco;
- insights são carregados do banco;
- relatório e feedback são carregados do banco;
- links mudam conforme o slug;
- nenhuma chave privada aparece no frontend;
- rota administrativa exige token;
- interface funciona em desktop e mobile.

---

## 17. Regra central

> O slug define qual cliente está acessando o portal. O servidor resolve o cliente, carrega os dados vinculados e garante que qualquer alteração seja aplicada somente ao registro correspondente, sem versionamento e sem compartilhamento de dados entre clientes.

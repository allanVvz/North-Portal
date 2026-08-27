# Capa dos cards — preview nas telas de Tarefas e Rotinas

## O problema

Um card de conteúdo é sobre uma peça — um vídeo, uma arte, um carrossel — mas
no quadro ele é um retângulo de texto igual a todos os outros. Para saber qual
peça é, abre-se o card. Num quadro com dezenas de cards por cliente, isso é a
diferença entre varrer a coluna com o olho e abrir seis cards.

A peça quase sempre já está no card: alguém colou o link do Drive na descrição
ou num comentário. O que falta não é o dado, é mostrá-lo.

## Formato do card

O card deixa de ser quadrado/horizontal e vira **vertical**, com uma **caixa
quadrada de capa acima do conteúdo atual**, sangrando até a borda.

A caixa é quadrada de propósito: é ela que dá às colunas cards de altura
previsível, independente da proporção do arquivo. Um card com capa 9:16 e outro
com capa 16:9 continuam medindo o mesmo.

O texto, a evolução e o rodapé continuam **abaixo** da capa, na ordem que já
têm. A capa entra por cima, não no meio.

### Onde a capa aparece

| Superfície | Formato | Por quê |
|---|---|---|
| Card no quadro (Tarefas, Rotinas) | quadrado, `1/1` | identifica o card numa coluna; quadrado mantém a altura previsível |
| Modal do card (`.tm-cover`) | faixa larga e fina, `5/1` | o card já está aberto e identificado — capa alta empurraria o conteúdo para baixo da dobra |
| Painel lateral (`.tdp-cover`) | faixa, `3/1` | mesma ideia, menos fina: a 5/1 numa coluna de 340px a imagem viraria um filete de 68px |

Modal e painel são as duas superfícies do mesmo clique — qual abre depende de
uma preferência de UI (`sidebarEnabled` em `KanbanBoard`), então as duas
precisam da capa.

No modal a capa lê a descrição do **rascunho**, não a salva: colar um link do
Drive na descrição mostra a capa na hora, antes de salvar.

### Enquadramento

**A capa sempre preenche a caixa e corta o que sobra** — deitada ou em pé,
`object-fit: cover` centrado. Uma regra de CSS, sem exceção.

A primeira versão enquadrava a imagem deitada inteira (`contain`), para não
cortar as laterais da paisagem, e media a proporção no `onLoad` para decidir.
Foi removida: as tarjas de fundo que sobravam em cima e embaixo não se lêem
como capa, se lêem como imagem quebrada — e numa coluna de cards isso vira
ruído repetido. Cortar as extremidades de uma paisagem custa menos do que isso.

Com uma regra só, a detecção de proporção deixou de ter função e saiu junto.

---

## Fase 1 — Drive ✅ IMPLEMENTADA

Imagem e vídeo do Google Drive viram capa automaticamente.

### Como a capa é escolhida

`lib/taskCover.ts`, função pura e testada. Devolve uma **lista ordenada de
candidatos**, não um só:

1. **Descrição do card** — todos os links do Drive, na ordem.
2. **Comentários**, do mais antigo para o mais novo.
3. Teto de 6 candidatos.
4. Nada disso → sem capa, card como sempre foi.

**Por que uma lista.** Nem todo arquivo do Drive rende miniatura: pode não
estar compartilhado, pode ter sido apagado, pode ser um formato sem prévia.
Medido nos dados de produção — 12 arquivos amostrados dos comentários — **só 2
respondiam miniatura**. Com um candidato só, um card com quatro arquivos
perfeitamente exibíveis ficava sem capa porque o primeiro link não abria. O
card tenta em ordem e para no primeiro que responder; cada 404 avança para o
próximo.

Duas decisões de ordem, ambas deliberadas:

- **Descrição antes de comentário**: a descrição é o conteúdo do próprio card.
  Quem escreveu a tarefa e já anexou a referência ali está dizendo qual é o
  material.
- **Comentário mais antigo antes do mais novo**: a capa fica estável conforme a
  thread cresce, em vez de trocar a cada comentário.

Reconhece as duas formas de link que existem no app: URL colada crua, e o
formato `[rótulo](url)` que a automação escreve
(`splitCommentText` em `lib/comments.ts`).

### O que vira capa e o que não vira

| Tipo | Vira capa? | Por quê |
|---|---|---|
| Imagem (`image/*`) | ✅ | é a peça |
| Vídeo (`video/*`) | ✅ um frame | ver abaixo |
| Pasta do Drive | ❌ | link de trabalho, não peça |
| Docs, Sheets, Slides | ❌ | têm miniatura, mas uma parede de miniatura de planilha não ajuda a ler o quadro |
| PDF | ❌ | mesma razão |
| Link que não é do Drive | ❌ | fora do escopo desta fase |

### Vídeo = um frame, leve

O `thumbnailLink` que o Drive devolve para um vídeo **já é um frame renderizado
pelo Google** — uma imagem estática. Nada de vídeo é baixado ou decodificado,
nem no servidor nem no navegador. O preview "leve" sai de graça.

### Como a miniatura chega no card

```
card  →  <img loading="lazy" src="/api/admin/drive/thumbnail/{fileId}">
             ↓
         requireAdmin
             ↓
         fetchDriveThumbnail()
             ├─ conta de serviço configurada?
             │     ↓ sim   Drive API: metadata (mimeType, thumbnailLink)
             │             Drive API: bytes da miniatura em =s480
             │             (falhou? cai para o público abaixo)
             └─ público:   drive.google.com/thumbnail?id=…&sz=w480
             ↓
         imagem, Cache-Control: private, max-age=3600
         (nada respondeu → 404, o card tenta o próximo candidato)
```

**Dois caminhos, de propósito.** O endpoint público não precisa de credencial
nenhuma e funciona para arquivo compartilhado como "qualquer pessoa com o
link" — a mesma premissa que o preview embutido do card já assumia. É o que faz
a capa existir **hoje**, sem conta de serviço configurada.

A conta de serviço, quando existir, cobre o que o público não cobre: arquivo
privado que foi compartilhado com ela. E mesmo com ela ligada o caminho público
segue de rede, porque a conta de serviço só enxerga o que foi compartilhado
com ela — um arquivo público que ela não vê continua rendendo capa.

A única situação em que **não** há queda para o público é quando a API respondeu
e disse que o arquivo é PDF/planilha/apresentação: aí sabemos o tipo e a
resposta é "não vira capa". Cair para o público furaria a regra.

**Limitação conhecida do caminho público**: ele não informa o tipo do arquivo,
só devolve a imagem. Então um PDF compartilhado publicamente e citado num
comentário *pode* virar capa enquanto a conta de serviço não estiver
configurada — a regra "só imagem e vídeo" só é aplicável pelo caminho da API,
que é quem sabe o `mimeType`. Preferi isso a não ter capa nenhuma; configurar a
conta de serviço resolve junto com o resto.

Três escolhas que valem registro:

**Por que uma rota por arquivo, e não resolver tudo na consulta da lista.** O
quadro tem dezenas de cards; resolver a capa de todos antes de desenhar
custaria uma ida ao Drive por card no caminho crítico. Com `loading="lazy"`, só
os cards que chegam à tela pedem capa, e o navegador cacheia.

**Por que servimos os bytes em vez de mandar o `thumbnailLink` ao navegador.**
Esse link é assinado e expira em algumas horas — a capa apareceria e sumiria
sozinha. E ele só é público quando o arquivo está compartilhado; pela nossa
rota, a conta de serviço enxerga o que já enxerga no resto da integração.

**Por que `Cache-Control: private`.** A rota é autenticada por sessão de admin.
A miniatura fica no navegador de quem pediu, nunca num cache compartilhado.

### Degradação

404 é resposta normal, não erro: arquivo que não é imagem nem vídeo, arquivo
não compartilhado, link quebrado, id inválido. O card avança para o próximo
candidato; acabando a lista, a capa some e o card fica exatamente como era
antes de existir capa. Nenhuma tela quebra.

### Cobertura real hoje

Sem conta de serviço, a capa depende do arquivo estar compartilhado como
"qualquer pessoa com o link". Medido card a card em produção — os 13 cards que
têm link do Drive, todos os candidatos testados:

| Resultado | Cards |
|---|---|
| Ganham capa | **4** |
| Sem nenhum arquivo acessível | **9** |

Dos 4 que ganham, **3 só ganham porque a varredura pula candidato**: o 1º e o
2º link não abrem, o 3º abre. Isso confirma que a lista de candidatos está
fazendo o trabalho dela.

Os 9 restantes não são problema de ordem nem de parser — nenhum dos arquivos
deles responde miniatura. É compartilhamento, e só se resolve fora do código.

Para cobrir o resto há dois caminhos, e eles se somam:

1. **Configurar `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`** — e, crucialmente,
   **compartilhar as pastas dos clientes com o e-mail da conta de serviço**. Só
   criar a credencial não basta: uma conta de serviço nova não enxerga nada do
   Drive pessoal de ninguém.
2. **Compartilhar os arquivos** como "qualquer pessoa com o link", que é o que
   o preview embutido dentro do card já exigia.

### Arquivos

| Arquivo | Papel |
|---|---|
| `lib/taskCover.ts` | escolha da capa (puro, cliente) |
| `lib/taskCover.test.ts` | 10 testes da escolha |
| `lib/googleDriveApi.ts` · `fetchDriveThumbnail()` | metadata + bytes (servidor) |
| `app/api/admin/drive/thumbnail/[fileId]/route.ts` | a rota |
| `app/admin/CardCover.tsx` | `<img>`, enquadramento, degradação |
| `app/globals.css` · `.card-cover` | caixa quadrada, sangria, `contain`/`cover` |
| `app/admin/KanbanBoard.tsx` | capa no card de Tarefas |
| `app/admin/operacao/OperacaoWorkspace.tsx` | capa no card de Rotinas |

Na visão de calendário das Rotinas (`compact`) a capa não entra — o card é
pequeno demais.

---

## Fase 2 — imagem colada direto, sem Drive

Hoje a capa só existe se a peça estiver no Drive. Falta cobrir:

- **imagem colada direto na descrição** (colar do clipboard no editor)
- **imagem colada direto num comentário**
- **arquivo já anexado ao card** (bucket `documents`, ver `lib/documentFiles.ts`)

O terceiro é o mais barato e o mais imediato: o anexo já está no nosso Storage,
com `mime_type` conhecido, e já existe `DocumentFilePreview`. A capa seria a
primeira imagem entre os anexos do card — sem rota nova, sem Drive.

Os dois primeiros exigem decidir onde a imagem colada é gravada. O caminho
natural é o mesmo bucket `documents`, entrando pelo fluxo de anexo que já
existe, de forma que "colar uma imagem" e "anexar um arquivo" convirjam para o
mesmo lugar — e aí a capa sai da mesma regra do item anterior.

**Ordem sugerida de fontes** quando tudo existir, estendendo `taskCover()`:

1. capa escolhida à mão (fase 3)
2. imagem na descrição
3. primeira imagem anexada ao card
4. primeira imagem/vídeo do Drive num comentário

## Fase 3 — escolher a capa à mão

Botão no **canto superior direito** do card (ou do modal), abrindo uma caixa
com as imagens que aquele card já tem: anexos, imagens da descrição, arquivos
do Drive citados nos comentários. Escolher uma fixa a capa.

Guardar em `payload.cover` — `{ kind: "drive" | "document", id }` — de forma que
`taskCover()` passe a consultar isso antes de deduzir. Sem migration: `payload`
já é `jsonb` livre.

Vale só depois da fase 2: com uma fonte só de imagem, escolher entre "a única
que existe" não resolve nada.

---

## O que ficou fora, e por quê

- **Miniatura de PDF/Slides**: o Drive dá, mas encheria o quadro de miniatura de
  documento. Se um dia entrar, entra atrás de uma preferência de UI, no padrão
  de `app/admin/kanbanPrefs.ts`.
- **Capa em Plano de Ação**: o card de plano é um agrupador, não uma peça.
- **Capa no portal do cliente**: o card do cliente tem outro desenho e outra
  regra de visibilidade — merece decisão própria, não herdar esta.

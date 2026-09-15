---
name: ged-north
description: O GED da plataforma — caminho padrão das pastas de cada cliente, provedores (armazenamento interno e Drive da plataforma), como um link do Google é copiado para dentro e a migração dos links antigos. Use antes de ler, salvar ou referenciar arquivos de cliente.
---

# GED — armazenamento interno

Decisão de 15/09: a plataforma tem o seu próprio GED. Arquivos de cliente não
dependem de links para Drives de terceiros; um link compartilhado é **copiado**
para dentro.

Na interface o nome é **Arquivos do cliente** — "GED", "provider" e
"armazenamento" são termos de código e documentação. A importação pelo Estúdio
passa pelo caso de uso `lib/northai/importFile.ts`.

## Caminho padrão

```
Clientes/<Nome do cliente> (<slug>)/
  Marca/
  Arquivos/
  Edição/
  Roteiros/     ← Google Docs importados
  Planilhas/    ← Google Sheets importados
  Relatórios/
```

Código: `lib/ged/paths.ts` (`GED_AREAS`, `gedFolderPath`). O caminho é o mesmo
em qualquer provedor.

## Provedores

| Provedor | Quando | Onde fica |
|---|---|---|
| Armazenamento interno | sempre | bucket `documents` do Supabase, chave `ged/clientes/<slug>/<área>/<id>-<arquivo>`; cada arquivo vira uma linha em `documents` (aparece em Informações) |
| Drive da plataforma | quando `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` e `GOOGLE_DRIVE_ROOT_FOLDER_ID` estão configurados | pastas criadas no cadastro do cliente (`provisionClientDriveFolders`); importações também são copiadas para a pasta do cliente (best-effort) |

Hoje (15/09) não há conta de serviço configurada — o GED usa só o
armazenamento interno. Configurar a conta "protagonista" é o R4.12 do roadmap.

## Importar um link do Google

`POST /api/admin/northai/import` → `importLinkIntoGed` (`lib/ged/index.ts`):

| Link | Cópia fiel | Texto lido |
|---|---|---|
| Google Docs | `.docx` | `.txt` → `scriptParser` separa os roteiros |
| Google Sheets | `.xlsx` | `.csv` |
| Google Slides | `.pdf` | — |
| Arquivo do Drive | o arquivo como está | — |
| Pasta | não copiável por link — envie o link de cada arquivo | — |

Sem conta de serviço, a cópia usa os endpoints públicos de exportação: o
arquivo precisa estar como **"Qualquer pessoa com o link"**. Se o Google
responder a página de login, a importação falha com esse aviso. Limite: 50 MB.

## Cadastro do cliente

O cadastro não pede mais link de pasta: todo cliente nasce com a árvore do GED
(com o Drive configurado, as pastas são criadas lá). Os links antigos colados
em `client_drive_links` continuam editáveis, recolhidos em "Links antigos do
Drive", até a migração.

## Migração (roadmap R4.12)

1. Configurar a conta de serviço e a pasta raiz da plataforma.
2. Criar a árvore para os clientes já cadastrados.
3. Para cada link antigo (marca, arquivos, edição), copiar o conteúdo para a área correspondente do GED.
4. Trocar links antigos em cards e comentários pelos do GED.

## Regras

- Nunca salve só o link de um arquivo de cliente: importe para o GED.
- A área vem do tipo do link (Docs → Roteiros, Sheets → Planilhas, resto → Arquivos) quando não informada.
- O original continua sendo do dono; a cópia no GED é a referência da plataforma.

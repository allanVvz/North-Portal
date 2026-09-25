# Modais de card e documento — plano de interface

## Uso principal

O operador abre um card para ver a entrega, alterar uma etapa e conversar. Ao abrir um documento, quer ler o arquivo antes de consultar seus metadados. A hierarquia visual segue essa ordem.

## Estrutura

| Área | Primeiro plano | Segundo plano |
| --- | --- | --- |
| Card | Título, etapa atual, nome dos cards ligados, comentários | Atributos e materiais |
| Documento | Preview e ações | Cliente, status e dados técnicos |

No desktop, o card usa quase toda a largura disponível e reserva uma lateral confortável para a conversa. No celular, conteúdo e comentários se empilham. O menu de cada comentário fica visível como três pontos e abre em um painel flutuante que não é cortado pela rolagem.

As etapas usam um ícone por função. A linha mostra o nome do card uma vez; o tipo permanece no `title` do ícone e nos rótulos acessíveis. A corrente ocupa um botão quadrado de 32 px com nome acessível. Nomes longos podem quebrar no celular.

O documento mantém um cabeçalho curto, preview dominante e painel lateral compacto. Tipo e data já aparecem no cabeçalho; a lateral concentra cliente, status, nome, formato e tamanho. Ações têm ícones e rótulos curtos. Em tela estreita, o preview ocupa a largura do modal e os detalhes vêm abaixo.

## Critérios de aceite

- Card e documento não geram rolagem horizontal em 1440 × 900 ou 390 × 844.
- Comentários têm área legível e o menu Editar/Excluir cabe na viewport nas duas larguras.
- Etapas ligadas exibem ícones distintos, nome único e corrente acessível.
- O preview do documento ocupa a largura útil no celular; título, fechar e ações continuam legíveis.
- E2E usa cards e documentos existentes, sem alterar registros, arquivos ou finais.

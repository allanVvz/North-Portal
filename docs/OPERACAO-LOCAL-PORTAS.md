# Operacao local segura: portas e cache do Next.js

Este projeto deve ter **uma unica instancia do Next.js por diretorio de trabalho**. Duas instancias apontando para o mesmo repositorio compartilham `.next/`; se um `next build` ou uma recompilacao alterar essa pasta enquanto outra instancia a le, podem surgir erros intermitentes como `500 Internal Server Error`, modulos ausentes e falhas em `/_app` ou `/_document`.

## Porta padrao

Use a porta `3000` para o desenvolvimento normal:

```powershell
npm run dev
```

Para uma verificacao isolada, escolha uma porta alternativa explicita, por exemplo `3010`:

```powershell
npm run dev -- -p 3010
```

Nao inicie uma segunda instancia no mesmo repositorio enquanto a primeira estiver ativa, mesmo que use outra porta. Uma porta diferente evita colisao de rede, mas nao evita a disputa pelo diretorio `.next`.

Os testes E2E devem reutilizar a instancia que ja esta ativa. Se o desenvolvimento estiver na porta `3001`, execute:

```powershell
$env:E2E_PORT = "3001"
npm run test:e2e
```

O `playwright.config.ts` usa `E2E_PORT` tanto no navegador quanto na verificacao do servidor. Isso impede o teste de iniciar silenciosamente outra instancia na porta `3000` e disputar o mesmo `.next`.

## Antes de iniciar ou gerar um build

Confira quais portas estao ocupadas:

```powershell
netstat -ano | findstr ":3000 :3001 :3002 :3010 :3011"
```

Se houver um processo `LISTENING`, identifique-o antes de encerrar:

```powershell
Get-Process -Id <PID>
```

Encerre somente o PID confirmado como servidor deste projeto:

```powershell
Stop-Process -Id <PID> -Force
```

Espere a porta deixar de aparecer como `LISTENING`. Entradas `TIME_WAIT` sao conexoes ja encerradas e nao bloqueiam uma nova inicializacao.

## Ordem segura para reiniciar

1. Pare todos os servidores Next deste repositorio.
2. Confirme que nenhuma porta planejada esta em `LISTENING`.
3. Rode `npm run build` **ou** `npm run dev`, nunca em paralelo com outro servidor local do mesmo checkout.
4. Aguarde a mensagem `Ready`.
5. Valide pelo menos `/`, `/login` e `/admin`.

Em PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/
Invoke-WebRequest -UseBasicParsing http://localhost:3000/login
Invoke-WebRequest -UseBasicParsing http://localhost:3000/admin -MaximumRedirection 0
```

Em `/admin`, um `307` para `/login` e esperado sem uma sessao autenticada. O problema e resposta `500`, nao esse redirecionamento.

## Se aparecer `Internal Server Error`

1. Nao inicie outro `npm run dev` por cima do servidor atual.
2. Salve e leia o log da instancia que respondeu `500`.
3. Verifique as portas com `netstat` e confirme os PIDs.
4. Pare apenas os processos Node associados a este repositorio.
5. Inicie uma unica instancia limpa em uma porta conhecida e reteste as tres rotas acima.

Nao apague `.next` enquanto um processo Next estiver ativo. Caso seja necessario limpar o cache apos todos os processos terem parado, faca-o apenas com o diretorio confirmado como `C:\Repositores\north-portal\.next`, depois reinicie uma unica instancia.

### Erro `Loading chunk ... failed`

Esse erro significa que o navegador manteve a referencia de um JavaScript antigo, enquanto o servidor recompilou `.next` e passou a servir arquivos novos. Ele nao indica falha da tarefa, do modal ou da API.

Depois do reinicio limpo do servidor, feche as abas do `localhost` que usavam a porta afetada e abra uma nova aba. Se necessario, faca recarga forcada com `Ctrl+Shift+R`. Nao abra um segundo `npm run dev` para tentar resolver o erro: isso recria a mesma causa.

## Registro do incidente de 2026-07-21

As portas `3000` e `3002` ainda tinham instancias Node antigas em execucao durante um build. Os logs mostravam arquivos gerados ausentes em `.next/server` e falhas ao carregar `/_app` e `/_document`. Apos encerrar esses dois processos e subir uma unica instancia limpa na porta `3010`, as rotas `/`, `/login` e `/admin` responderam normalmente (`200`, `200` e `307` de autenticacao, respectivamente). Nao houve evidencia de falha no Supabase, na migration de recorrencias ou na integracao Windsor.ai.

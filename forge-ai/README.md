# EGalhardo IA — AI Dev Workspace

## Executar
```bash
npm install
npm run dev:all        # API (porta 8787) + interface (porta 5173)
```
Abre http://localhost:5173. As Definições abrem sozinhas: escolhe o fornecedor e cola a chave de API.

Também podes configurar por variáveis de ambiente:
```bash
FORGE_PROVIDER=anthropic FORGE_API_KEY=sk-ant-... npm run dev:all
```
Fornecedores: `anthropic`, `openai`, `gemini`, `ollama` (local, sem chave).

## Testar sem chave (grátis, 100% local)
```bash
# instalar Ollama: https://ollama.com/download
ollama pull qwen2.5-coder:7b          # recomendado (precisa ~8 GB RAM)
FORGE_PROVIDER=ollama FORGE_MODEL=qwen2.5-coder:7b npm run dev:all
```
Modelos pequenos (1.5B) funcionam mas erram muito. Para apps complexas usa Claude, GPT ou Gemini
(o Gemini tem nível gratuito: https://aistudio.google.com/apikey).

## Testes
```bash
npm run test:server    # 42 testes: ferramentas (13), sandbox (22), configuração (7) — sem IA
```

## Protecções do agente
- Acesso a ficheiros limitado à pasta do projecto (bloqueia `../`).
- Verificação de sintaxe JS/TS após cada escrita; os erros são devolvidos ao modelo para ele corrigir.
- Nunca substitui um ficheiro válido por uma versão com erros de sintaxe.
- Tolera erros comuns dos modelos (editar ficheiro inexistente, espaços diferentes, respostas vazias,
  código escrito como texto em vez de chamar ferramentas).
- Resumo factual no fim de cada tarefa (ficheiros realmente alterados), independente do que o modelo diz.

## Arquitectura
- `server/index.ts` — API HTTP e streaming de eventos (SSE)
- `server/agent.ts` — ciclo do agente (modelo → ferramenta → resultado → …, até 40 passos)
- `server/llm.ts` — adaptadores Anthropic / compatíveis com OpenAI (sem SDK)
- `server/tools.ts` — ferramentas: list_files, read_file, write_file, edit_file, delete_file, search_files
- `server/syntax.ts` — verificação de sintaxe com o compilador TypeScript
- `server/sandbox.ts` — execução isolada de comandos (bwrap / docker / local)
- `server/projectFs.ts` — acesso a ficheiros restrito a `server/projects/<projecto>`
- `src/` — interface React. Se o servidor não responder, a app passa para o modo Demo.

## Execução de comandos (Fase 2)
O agente tem a ferramenta `run_command` (npm install, build, testes, tsc…). Cada comando corre numa sandbox:

| Modo | Quando | Isolamento |
|---|---|---|
| `bwrap` | Linux com bubblewrap (`sudo apt install bubblewrap`) | Só a pasta do projecto é visível/gravável; sistema só-leitura; PIDs isolados; chaves invisíveis |
| `docker` | Docker disponível | Contentor descartável por comando (1 GB RAM, 1 CPU, 256 processos) |
| `local` | Nenhum dos anteriores | **Sem isolamento** (só ambiente limpo sem chaves). Apenas para desenvolvimento |

Escolha automática, ou força com `FORGE_SANDBOX=bwrap|docker|local`.
Limites: timeout 180 s por omissão (máx. 600 s), output máx. 200 KB, Stop mata o processo e todos os filhos.
Servidores de desenvolvimento (`npm run dev`) são recusados: chegam na Fase 3.

## Limites actuais
- O histórico do modelo fica em memória: reiniciar o servidor apaga o contexto das conversas (os ficheiros ficam).
- Sem servidores de desenvolvimento / pré-visualização (Fase 3).

## Fase 3 — Servidores de desenvolvimento, pré-visualização e memória persistente

### O que faz
- **Processos em segundo plano** (`server/processes.ts`): o agente usa `start_process` (ex.: `npm run dev`), que espera até o servidor estar pronto e devolve os logs. Tem também `get_process_logs` e `stop_process`. O `run_command` recusa comandos que não terminam e aponta para `start_process`.
- **Portas sem conflitos**: vite / next dev / astro dev recebem `--port <n> --strictPort --host 127.0.0.1` automaticamente (a partir de 3100). Os outros comandos recebem `$PORT`. As portas da EGalhardo IA (5173, 4173, 8787, 11434, 8790–8799) estão reservadas.
- **Proxy de pré-visualização** por processo (portas 8790–8799, `0.0.0.0`). Reescreve Host/Origin, remove `X-Frame-Options`/`frame-ancestors` e encaminha WebSockets, por isso **o HMR funciona dentro do iframe**.
- **UI**:
  - painel de pré-visualização (barra de URL, recarregar, vista telemóvel, logs ao vivo, abrir num novo separador, parar);
  - cartões de servidor no Workspace (pré-visualizar / parar / reiniciar / remover) e "Iniciar servidor" manual;
  - cartão "App em execução" no chat depois de `start_process`;
  - o painel abre sozinho quando o servidor fica pronto.
- **URL pública**: em sandboxes cloud (`<porta>-<id>.dominio`), a porta do prefixo é trocada. Localmente usa-se `host:porta`.
- **Limites**: 3 processos por projeto e 5 no total. Um comando repetido reutiliza o processo existente. Tudo é terminado quando a API fecha.
- **Memória persistente**: o histórico de cada conversa fica em `server/.data/histories/<id>.json` e sobrevive a reinícios. A compactação encurta outputs antigos e mantém intactas as últimas 12 mensagens.

### API
`GET/POST /api/processes` · `POST /api/processes/:id/stop|restart` · `GET /api/processes/:id/logs` · `GET /api/processes/:id/stream` (SSE) · `DELETE /api/processes/:id`

### Testes
`npm run test:server` inclui `history.test.mts` e `processes.test.mts` (22 verificações: portas, proxy, iframe, WebSocket, fallback `$PORT`, crash, limites, stop sem órfãos, restart).

## Fase 4 — Contas e base de dados

### O que faz
- **SQLite** (`better-sqlite3`, modo WAL) em `server/.data/forge.db`, com migrações versionadas. Guarda utilizadores, sessões, projetos (com dono), conversas, históricos do agente, definições de IA por utilizador, utilização (tokens) e definições da app. A pasta pode ser mudada com `FORGE_DATA_DIR`.
- **Contas**: a primeira conta criada é **administrador** e adota os projetos existentes. Depois disso, o registo público fica **fechado**: o admin cria contas ou abre o registo nas Definições. Cada conta nova recebe um projeto inicial (`projeto-<id>`).
- **Segurança**:
  - palavras-passe com scrypt;
  - sessão num cookie `HttpOnly; SameSite=Lax`, que passa a `Secure` em https; no servidor só se guarda o hash SHA-256 do token;
  - limite de tentativas de login;
  - proteção CSRF por verificação de origem, que bloqueia também as apps em pré-visualização;
  - as chaves de API ficam **cifradas (AES-256-GCM)**; a chave de cifra vem de `server/.data/secret.key` ou de `FORGE_SECRET`;
  - mudar a palavra-passe termina as outras sessões.
- **Isolamento**: cada utilizador só vê e altera os seus próprios projetos, ficheiros, processos, conversas, chave de API e utilização.
- **Conversas no servidor**: sincronizadas automaticamente e disponíveis em qualquer browser. Não ficam no `localStorage` e desaparecem do browser ao terminar sessão. Na primeira entrada, as conversas locais antigas são importadas.
- **Definições** com separadores: Modelo de IA, Conta (perfil, palavra-passe, sessões), Utilização (tokens por dia e por modelo) e Utilizadores (só admin: criar, promover, desativar, apagar, abrir ou fechar o registo).

### Variáveis de ambiente
`FORGE_DATA_DIR`, `FORGE_SECRET` (recomendado em produção), `FORGE_SESSION_DAYS` (30 por omissão), `FORGE_SIGNUP=open`.

### Testes
- `server/tests/auth.test.mts`: 49 verificações HTTP contra um servidor real numa pasta de dados temporária.
- `server/tests/config.test.mts`: configuração por utilizador e cifragem.
- `server/tests/e2e/accounts_ui.py`: 19 verificações no browser (Playwright).
- `server/tests/fixtures/mock-llm.mjs`: LLM simulado para testar sem chaves.
- `server/tests/e2e/reset-db.sh`: apaga a base de dados local (só em desenvolvimento).

### Arranque robusto e sessões em iframes
- `./start.sh` (ou `npm start`) arranca a API e a interface. Antes disso, repara a instalação: reinstala `node_modules` se faltar ou estiver partido e recompila a interface se `dist/` estiver em falta ou desatualizado. `./start.sh --dev` arranca com hot reload.
- A sessão funciona dentro de iframes de outros sites, onde os browsers bloqueiam cookies (por exemplo, em pré-visualizações alojadas). O login devolve um token que a interface envia em `Authorization: Bearer`; o cookie HttpOnly fica como alternativa. Se, mesmo assim, a sessão não ficar ativa, a interface mostra um erro em vez de ficar parada.
- Teste de regressão: `python3 server/tests/e2e/iframe_login.py EMAIL SENHA` (iframe de outro site com cookies de terceiros bloqueados).

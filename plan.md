# Plan — Code Review & Safe Modular Refactor (Max Coder)

## Objetivo

Avaliar e reorganizar o projeto **`maxcoder/`** por módulos coesos, aplicar early-return + lookup
tables + erros normalizados + config centralizada, mover testes para `tests/` espelhando `src/`, e
garantir cobertura — **sem alterar comportamento** (TDD: caracterizar antes de refatorar).

## Estado atual encontrado

Resumo (detalhe em `docs/code-review/01-current-state.md`):
- Testes **ao lado do `src/`** (4 arquivos) → precisam ir para `tests/` espelhando `src/`.
- `process.env` em **8 arquivos / 14 sites**; **dois** `config.ts` → config não centralizada.
- Sem taxonomia de erros (1 classe custom; 8 `throw new Error`).
- Duplicação `stripTags`/`decodeEntities` (extractor + duckduckgo).
- God files: `tui.ts` (568), `cli.ts` (386); `ollama.ts chat()` com múltiplas responsabilidades.
- **Core do agente sem testes** (agent/context/session/systemPrompt/mcp). `websearch/` bem coberto.
- Switches **já** convertidos para lookup tables (tarefa anterior).

## Decisões técnicas

- **Framework de teste:** `bun:test` (já em uso) — sem instalação nova.
- **Local dos testes:** `maxcoder/tests/` espelhando `maxcoder/src/` (regra obrigatória).
- **Typecheck:** `tsc --noEmit` via script `typecheck` (adicionar — justificado; não mexe em versões).
  Atualizar `tsconfig.include` para `["src","tests"]`.
- **Lint:** não há lint configurado. Proposta: **Biome** (zero-config, rápido) — instalar só após
  aprovação; até lá, `typecheck` é o gate. (Regra: não instalar sem propor.)
- **Estrutura-alvo (incremental, não aplicar cega):**
  ```
  src/
    core/        agent, context, systemPrompt
    providers/   ollama (+ futuros)
    sessions/    session
    tools/       registry, datetime, subagent, skills, mcp, websearch/
    ui/          cli, tui, ui, brand
    shared/      config/, errors/, html/, fs (fsx)
  ```
  Começar pelos módulos NOVOS (`shared/`) que outros importam — menor risco que mover arquivos.
- **Sem abstração prematura:** extrair helper só quando houver ≥2 usos reais (ex.: `shared/html`).

## Convenções obrigatórias

Early return · lookup tables (não switch) · funções pequenas (validar/normalizar/executar/erro/saída)
· módulos coesos por domínio · tipagem forte (sem `any`) · erros normalizados
(`ValidationError`/`ProviderError`/`ToolExecutionError`/`ConfigurationError`) · config central
(`src/shared/config`) · injeção de dependências para testabilidade (cwd/clock/env por parâmetro) ·
testes em `tests/` espelhando `src/` · TDD (teste antes da refatoração).

## Tarefas

- [x] 1. Mapear estrutura atual (`docs/code-review/01-current-state.md`).
- [x] 2. Identificar módulos principais.
- [x] 3. Identificar arquivos críticos.
- [x] 4. Identificar ausência de testes.
- [ ] 5. Criar estrutura de testes em `tests/` (mover os 4 testes existentes, corrigir imports).
- [ ] 6. **Caracterização**: criar testes do comportamento ATUAL para o core sem cobertura
       (`session`, `context` compaction, `systemPrompt`, `tools` registry, `agent` loop-guard,
       `skills`/`subagent` frontmatter, `fetcher`/`extractor`). ← TDD/segurança antes de refatorar.
- [ ] 7. Refatorar com early-return (varredura: `cli`, `tui`, `ollama.chat`, guardrails, ranker).
- [ ] 8. Lookup tables onde ainda fizer sentido (já feito p/ switches; revisar if-chains longos).
- [ ] 9. Separar responsabilidades: `shared/{config,errors,html}`; depois mover por domínio (incremental).
- [ ] 10. Normalizar erros (criar `shared/errors`, trocar `throw new Error` por classes específicas).
- [ ] 11. Centralizar configuração (`shared/config` tipada; remover `process.env` espalhado).
- [ ] 12. Remover duplicações seguras (`stripTags`/`decodeEntities` → `shared/html`).
- [ ] 13. Rodar testes (`bun test`).
- [ ] 14. Rodar lint (se adotado) — senão justificar.
- [ ] 15. Rodar typecheck (`tsc --noEmit`).
- [ ] 16. Relatório final (`docs/code-review/02-final-report.md`) + cross-check Codex.

Ordem de execução segura (menor risco → maior): 5 → 6 → 10/11/12 (shared, aditivo) → 7 → 9 (mover
arquivos, **só com o writer paralelo pausado**) → 13/14/15 → 16.

## Riscos

- **(TOP) Writer concorrente** reescrevendo `cli/tui/ui/fsx/session/tsconfig/package.json` →
  clobber de refatorações = regressão. **Pausar antes da reorg de diretórios.**
- Mover arquivos quebra imports relativos + `tsconfig.include` + `bun build src/cli.ts`.
- Core sem testes (compaction/stream/rehydrate) → quebra silenciosa. Mitigação: caracterização (T6) antes.
- Bun não typecheck no build → adicionar `tsc` para pegar erros de tipo do refactor.

## Rollback

Tudo incremental e por etapa. `shared/*`, mover testes, e novos testes são aditivos (reverter =
apagar). Reorg de diretórios feita em commits pequenos por domínio → reverter o commit do domínio.
Nenhuma mudança de versão; comportamento preservado por testes de caracterização.

## Como testar

`cd maxcoder && bun test` (após mover para `tests/`, discovery do Bun acha `*.test.ts` em qualquer
lugar) · `bunx tsc --noEmit` (typecheck) · `bun build src/cli.ts --compile` (smoke build) ·
`./dist/maxcoder doctor` (registro de tools) · cross-check final no **Codex** (`codex exec` read-only).

# AGENTS.md

This file provides guidance to AI agents (like Qoder, Claude, Cursor, etc.) working with this codebase.

## Project Overview

DeepJIT is a JIT compiler plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh), an open-source agent harness where everything is a plugin. DeepJIT
continuously captures execution traces (SQLite), mines recurring "hot" tool
flows, compiles them via LLM into reusable **skills** (markdown) or **flows**
(JSON step templates), and feeds them back into the running harness —
automatically, without restart.

## Architecture

```
session/event + tools/result → collector → SQLite traces (~/.dsh/deepjit/deepjit.db)
                                        ↓ ctx.interval
                          miner (tool n-grams + intent keywords) → patterns
                                        ↓
                  summarizer: JSONL drill-down + ctx.llm.stream → strict JSON
                                        ↓
        skill → ~/.dsh/deepjit/skills/<name>/SKILL.md (filesystem hot reload,
                 runtime registration fallback)
        flow  → ~/.dsh/deepjit/flows/<name>.json (deepjit_flow tool replays)
```

### Modules

- `src/index.ts` — plugin entry (`name`, `inject`, `apply`): wires collector,
  JIT interval, tools, cleanup. `inject` = `['llm', 'skills', 'tools', 'sessionPersistence', 'timer']`.
- `src/config.ts` — Schemastery `Config` schema (all knobs have defaults).
- `src/store.ts` — `node:sqlite` `DatabaseSync` store, WAL, schema v1, batched
  transactional inserts, watermark queries, patterns/artifacts CRUD.
- `src/collector.ts` — `session/event` + `tools/result` listeners → buffered
  compact `TraceRow`s; call/result pairing by callId; raw value attach.
- `src/miner.ts` — per-session tool-sequence n-gram counting + intent keyword
  TF; cross-session aggregation (`count`, `sessions_seen`).
- `src/summarizer.ts` — candidate selection, JSONL drill-down via
  `sessionPersistence.readFrom`, LLM compile prompt, strict JSON validation
  (kebab names, known tool names), retry on parse/transport failures.
- `src/feedback.ts` — artifact publish: write SKILL.md / flow JSON; mechanism A
  (filesystem provider discovery) with mechanism B (runtime `ctx.skills.register`)
  fallback; disable/enable/remove helpers.
- `src/flow-executor.ts` — `deepjit_flow` tool: `${input.x}` mapping,
  `ctx.tools.execute` per step (permission system applies), `onError` policy.
- `src/status-tool.ts` — `deepjit_status` tool: list/show/disable/enable/delete.
- `src/paths.ts` — resolve dsh home and artifact directories.

## Key Invariants

1. **Ignore yourself**: `deepjit_*` tools never enter trace collection
   (`collector.ts`), mining (`miner.ts`), or flow templates (`flow-executor.ts`).
   JIT must not compile its own execution — new deepjit tools must stay excluded.
2. **Model-following**: compilation uses the session's actual provider/model
   from `request/context`; `llmModel` config is fallback-only.
3. **Message shape**: every LLM message content is a `ContentBlock[]` array —
   string content breaks the DeepSeek adapter's `flattenText` (TRANSPORT errors).
4. **Isolation**: artifacts live under `~/.dsh/deepjit/` only; skill names get
   the `deepjit-` prefix; never touch `~/.dsh/skills` or project skill dirs.
5. **Cleanup**: on unload, flush the collector, wait for in-flight JIT runs
   (10s cap), dispose runtime registrations, then close the store.

## Testing

- `npm test` — builds `dist/` then runs `node --test dist/tests/*.test.js`.
- Tests must stay green; add coverage for new modules.
- E2E (manual): `dsh plugin --profile headless add <repo>` +
  `DEEPSEEK_API_KEY=... dsh --profile headless "<task>"`, then inspect
  `~/.dsh/deepjit/deepjit.db` and the skills/flows directories.

## Dependency Notes

- Runtime deps are pinned (`@deepseek-ai/*` 0.1.0-rc.7, cordis 4.0.1) because
  dsh is pre-release and registry baselines drift from master.
- Node `^22.19 || >=24` (node:sqlite required).

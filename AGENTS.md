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
- `src/store.ts` — `node:sqlite` `DatabaseSync` store, WAL, schema v4
  (sessions/traces/patterns/pattern_sessions/artifacts), batched transactional
  inserts, watermark queries, patterns/artifacts CRUD.
- `src/collector.ts` — `session/event` + `tools/result` listeners → buffered
  compact `TraceRow`s; call/result pairing by callId; raw value attach.
- `src/miner.ts` — per-session tool-sequence n-gram counting + intent keyword
  TF; aggregation where `count` accumulates occurrences but `sessions_seen`
  counts **distinct** sessions (via `pattern_sessions`), so incremental re-mining
  of one session does not inflate the cross-session gate.
- `src/summarizer.ts` — candidate selection, transcript drill-down via
  `sessionPersistence` (legacy `readFrom` **or** the dsh 0.1.5 handle path
  `open()`/`read()`/`close()`, whichever the host provides), LLM compile prompt,
  strict JSON validation (kebab names, known tool names), retry on parse/transport
  failures.
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
   Since dsh 0.1.7 a system-role `RequestMessage` requires durable `id`/`source`,
   so one-shot compile calls pass the system prompt via `GenerateOptions.system`
   (only identity-free user messages go in `messages`).
4. **Isolation**: artifacts live under `~/.dsh/deepjit/` only; skill names get
   the `deepjit-` prefix; never touch `~/.dsh/skills` or project skill dirs.
5. **Cleanup**: on unload, flush the collector, wait for in-flight JIT runs
   (10s cap), dispose runtime registrations, then close the store.

## Testing

- `npm test` — runs `node --test "tests/*.test.ts"` directly (Node type-stripping);
  it does **not** build `dist/`. Use `npm run build` (`tsc -p tsconfig.json`) to
  compile `src/` → `dist/`.
- `dist/` is **committed** and is what npm publishes and `github:` installs load
  (`files: ["dist", "cordis.patch.yml"]`, no `prepublishOnly`). After changing
  `src/`, run `npm run build` and commit the updated `dist/`. CI enforces this:
  it runs `npm run build && git diff --exit-code dist`, so a stale committed
  `dist/` fails the build. (A stale `dist/` once shipped the broken `CallId`
  import even though `src/` was fixed — keep them in sync.)
- Tests must stay green; add coverage for new modules.
- E2E (manual): `dsh plugin --profile headless add <repo>` +
  `DEEPSEEK_API_KEY=... dsh --profile headless "<task>"`, then inspect
  `~/.dsh/deepjit/deepjit.db` and the skills/flows directories.

## Dependency Notes

- Runtime deps are exact-pinned (`@deepseek-ai/*` 0.1.7-rc.2, cordis 4.0.4)
  because dsh is pre-release and registry baselines drift from master. The
  `@deepseek-ai/*` `latest` dist-tags can point to **older** builds (e.g.
  `0.0.1-rc.x`), so never `npm install @latest` / `npm update` these — bump
  explicit exact versions only, then re-run gates.
- dsh 0.1.7+ packages declare host-provided peers (`dsh-agent`, `dsh-scope`,
  `dsh-ptc-runtime`, ...) that this plugin never imports; `.npmrc` sets
  `legacy-peer-deps=true` so `npm install` can resolve. Keep dependencies to
  packages actually imported in `src/` (side-effect type augmentations count):
  currently `cordis`, `dsh-session`, `dsh-tools`, `cordis-plugin-timer`,
  `schemastery` (+ `@opentelemetry/api`).
- Node `^22.19 || >=24` (node:sqlite required).

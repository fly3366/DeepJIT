# DeepJIT

A JIT compiler plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

[中文文档](README.md)

Following the semantics of a JVM JIT compiler: continuously capture agent
execution traces, identify recurring "hot" workflows, compile them with an LLM
into reusable assets — **skills** (markdown instructions) or **flows** (JSON
step templates) — and feed them back into the running harness automatically,
without restart.

## How it works

```
session/event + tools/result ──► SQLite compact trace index (~/.dsh/deepjit/deepjit.db)
                                     │
                        ctx.interval (default 10min)
                                     ▼
                 Hot-path mining: tool-sequence n-grams + intent keywords
                                     ▼
                 JIT compile: JSONL session drill-down → LLM outputs strict JSON
                                     ▼
         skill → ~/.dsh/deepjit/skills/<name>/SKILL.md (filesystem provider hot reload)
         flow  → ~/.dsh/deepjit/flows/<name>.json (replayed by the deepjit_flow tool)
```

- **Compact persistence**: only user messages, final assistant text, tool calls
  (args/results/timing), turn/step boundaries, timestamps, and usage are stored;
  no per-token chunks or reasoning. Full text is drilled down from JSONL session
  logs at compile time via `ctx.sessionPersistence`.
- **Isolation**: all artifacts live under `~/.dsh/deepjit/`; the top-level
  `~/.dsh/skills/` and project skill dirs are never touched; skill names carry a
  `deepjit-` prefix.
- **Auto feedback**: skills are hot-discovered by the skill-filesystem watcher
  (mechanism A), with runtime `ctx.skills.register` fallback (mechanism B).
- **Permissions preserved**: every flow step executes through `ctx.tools.execute`
  and still passes the `tools/pre-execute` permission gates.
- **Follows your model**: compilation reuses the provider/model actually used by
  the current session (captured from `request/context` events); `llmProvider` /
  `llmModel` are fallback-only.
- **Ignores itself**: deepjit's own tools (`deepjit_flow` / `deepjit_status`)
  are excluded from trace collection, mining, and flow validation — JIT never
  compiles its own execution, preventing self-compilation loops. The compile
  LLM call goes through the plugin's in-process channel and produces no session
  events.

## Installation

### Local development (bundle)

```sh
npm install && npm run build
dsh plugin --profile headless add /path/to/deepjit   # or web
dsh --profile headless --dump-config                 # verify the deepjit layer
```

### Published

```sh
dsh plugin --profile web add deepjit
```

## Configuration (override in cordis.patch.yml or a profile patch)

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | master switch |
| `dbPath` | `~/.dsh/deepjit/deepjit.db` | SQLite path |
| `flushIntervalMs` | `200` | trace batch flush interval |
| `flushBatchSize` | `200` | rows per flush batch |
| `maxResultChars` | `4000` | tool result/arg truncation length |
| `summarizeIntervalMs` | `600000` | JIT cycle (mine + compile) |
| `minIntervalMs` | `300000` | minimum interval between compiles |
| `llmProvider` | `deepseek-official` | compile provider (fallback; follows session by default) |
| `llmModel` | (empty) | compile model (fallback; empty = reuse session model) |
| `minRepeat` | `3` | min occurrences for a hot sequence |
| `ngramMin` / `ngramMax` | `2` / `4` | sequence window |
| `topK` | `5` | max candidates compiled per cycle |
| `skillDir` / `flowDir` | `~/.dsh/deepjit/...` | artifact directories |
| `feedbackMode` | `auto` | feedback mechanism selection |
| `stepTimeoutMs` | `120000` | per-step timeout in flows |
| `flowTimeoutMs` | `600000` | total flow timeout (reserved) |

## Agent-facing tools

- **`deepjit_status`**: `list` / `show` / `disable` / `enable` / `delete` to
  manage compiled artifacts.
- **`deepjit_flow`**: execute a flow template with `{flow, args}`; step
  arguments bind via `"${input.x}"` templates with dot-path support.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

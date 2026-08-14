<p align="center">
  <img src="assets/banner.jpeg" alt="DeepJIT banner" width="800">
</p>

# DeepJIT

A JIT compiler plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

[中文文档](README.zh.md)

## Overview

DeepJIT watches agent execution traces, mines recurring "hot" workflows, and
compiles them with an LLM into reusable **skills** (markdown) or **flows**
(step templates) — then feeds them back into the running harness, no restart.
It is for anyone who repeats similar multi-tool workflows and wants dsh to
turn them into fast, reusable assets.

```
traces ──► SQLite ──► hot-path mining ──► LLM compile ──► skills / flows ──► dsh
```

## Compatibility

| Item | Value |
|---|---|
| DSH version | `@deepseek-ai/dsh` `0.1.0-rc.6` (verified) |
| Verified commit | `5869674` (2026-08-13) |
| Node | `^22.19 \|\| >=24` |
| Profiles | `headless`, `web` |

dsh is pre-release; APIs may drift. Pins `@deepseek-ai/*` to `0.1.0-rc.6`.

## Install / Uninstall

```sh
# install (git, no npm release needed)
dsh plugin --profile web add github:fly3366/DeepJIT

# disable for one profile
dsh plugin --profile web remove deepjit

# fully remove local data
rm -rf ~/.dsh/deepjit
```

## Quick start

```sh
dsh plugin --profile headless add github:fly3366/DeepJIT
DEEPSEEK_API_KEY=... dsh --profile headless "read package.json and tsconfig.json, then summarize"
# repeat similar tasks; deepjit mines and compiles hot flows automatically
dsh --profile headless "use deepjit_status to list compiled artifacts"
```

## Configuration

Override in `cordis.patch.yml` or a profile patch. Key options (full list in
[`src/config.ts`](src/config.ts)):

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | master switch |
| `summarizeIntervalMs` | `600000` | JIT cycle (mine + compile) |
| `minRepeat` | `3` | min occurrences for a hot sequence |
| `llmProvider` / `llmModel` | `deepseek-official` / (session) | compile model; empty = reuse session model |
| `locale` | `auto` | `en` / `zh` / `auto` (dsh locale → `LANG` → English) |

Sensitive: no keys are stored. The compile call uses dsh's credential service
or the launching environment's `DEEPSEEK_API_KEY`.

## Permissions & data

- **Files**: writes only under `~/.dsh/deepjit/` (SQLite traces, skills, flows, log);
  reads session JSONL via `ctx.sessionPersistence` for compile drill-down.
- **Network**: LLM calls go through dsh's `ctx.llm` (DeepSeek provider); no other network access.
- **Credentials**: none stored; resolved by dsh or the environment.
- **User data**: stores compact execution traces (tool args/results, message text).
- **Tools**: flow steps run through `ctx.tools.execute` and the normal permission gates.

## Troubleshooting

- Log: `~/.dsh/deepjit/deepjit.log`. Database: `~/.dsh/deepjit/deepjit.db`.
- `MISSING_CREDENTIAL` → export `DEEPSEEK_API_KEY` or store it in dsh's Models page.
- `TRANSPORT`/`NO_ADAPTER` on compile → usually a transient LLM call failure; deepjit retries and falls back to the next cycle.
- Roll back: `dsh plugin --profile <p> remove deepjit`, then `rm -rf ~/.dsh/deepjit`.

## Development

```sh
npm install && npm test     # node:test, run natively via Node type stripping
npm run typecheck && npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License & security

[MIT](LICENSE). Report vulnerabilities privately per [SECURITY.md](SECURITY.md).

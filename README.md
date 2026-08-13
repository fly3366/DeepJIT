<p align="center">
  <img src="assets/banner.jpeg" alt="DeepJIT banner" width="800">
</p>

# DeepJIT

A JIT compiler plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

[中文文档](README.zh.md)

DeepJIT watches agent execution traces, mines recurring "hot" workflows, and
compiles them with an LLM into reusable **skills** (markdown) or **flows**
(step templates) — then feeds them back into the running harness, no restart.

```
traces ──► SQLite ──► hot-path mining ──► LLM compile ──► skills / flows ──► dsh
```

- Artifacts live under `~/.dsh/deepjit/` and hot-reload into dsh automatically.
- Compilation reuses the session's actual model; flows still pass permission gates.
- JIT never compiles its own tools, so it can't feed on itself.

## Install

```sh
dsh plugin --profile web add github:fly3366/DeepJIT
```

## Tools

- `deepjit_status` — list / show / disable / enable / delete compiled artifacts.
- `deepjit_flow` — replay a compiled flow with `{flow, args}`.

## Develop

```sh
npm install && npm test
```

All knobs (intervals, thresholds, locale, paths) are documented in
[`src/config.ts`](src/config.ts). See [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md), [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

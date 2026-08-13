# Contributing to DeepJIT

Thank you for your interest in contributing to DeepJIT! This document provides
guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js `^22.19.0 || >=24.0.0`
- npm (or pnpm)
- A DeepSeek API key (`DEEPSEEK_API_KEY`) for end-to-end JIT compilation tests
- A `dsh` CLI installation (`npx @deepseek-ai/dsh`) for integration runs

### Getting Started

```bash
# Clone the repository
git clone https://github.com/fly3366/DeepJIT.git
cd DeepJIT

# Install dependencies
npm install

# Typecheck and unit tests
npm run typecheck
npm test

# Load the plugin into a dsh profile (local development)
npm run build
dsh plugin --profile headless add /path/to/DeepJIT
dsh --profile headless --dump-config   # verify the deepjit layer is loaded
```

## Project Structure

```
src/
  index.ts           # plugin entry: wiring, lifecycle, JIT interval
  config.ts          # Schemastery config schema
  store.ts           # node:sqlite store (WAL, migrations, queries)
  collector.ts       # session/event + tools/result -> compact traces
  miner.ts           # hot-path mining (tool n-grams, intent keywords)
  summarizer.ts      # LLM compilation into skill/flow artifacts
  feedback.ts        # artifact publishing + skill discovery (A/B)
  flow-executor.ts   # deepjit_flow tool (template replay)
  status-tool.ts     # deepjit_status tool (list/show/disable/enable/delete)
  paths.ts           # dsh home / artifact directory resolution
tests/               # node:test suites (run against dist/)
```

## Guidelines

- Keep the "ignore yourself" invariant: JIT must never compile its own
  `deepjit_*` tools. New tools added to this plugin must be excluded from trace
  collection, mining, and flow validation.
- All LLM calls go through `ctx.llm.stream` with `ContentBlock[]` message
  content (string content breaks the DeepSeek adapter's `flattenText`).
- Never commit API keys, credentials, or machine-specific absolute paths.
- Follow the harness conventions: kebab-case skill names, `deepjit-` prefix for
  published artifacts, `.js`-suffixed relative imports (NodeNext ESM).
- Add tests for every module; `npm test` must stay green.

## Commit Messages

Keep a Changelog entry for user-visible changes, and use conventional commit
subjects, e.g. `feat:`, `fix:`, `docs:`, `refactor:`.

## Code of Conduct

Be respectful and constructive. Harassment and discrimination are not tolerated.

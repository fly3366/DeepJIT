# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-13

### Added
- SQLite trace persistence (`node:sqlite`, WAL, batched writes) for compact
  execution traces: user/assistant messages, tool calls with args/results and
  timing, turn/step boundaries, token usage.
- Hot-path mining: tool-sequence n-grams (window 2-4) and intent keywords
  aggregated across sessions into a patterns table.
- JIT compilation: periodic (or on-interval) LLM summarization that drills down
  into JSONL session logs via `sessionPersistence` and emits strict JSON
  artifacts — skills (markdown) or flows (step templates).
- Artifact feedback: skills published to an isolated `~/.dsh/deepjit/skills`
  directory and hot-discovered by the skill-filesystem provider (mechanism A),
  with runtime `ctx.skills.register` fallback (mechanism B); flows stored under
  `~/.dsh/deepjit/flows`.
- `deepjit_flow` tool: replays compiled flow templates with `${input.x}`
  argument mapping; every step runs through the harness permission pipeline.
- `deepjit_status` tool: list/show/disable/enable/delete compiled artifacts.
- Model-following: compilation reuses the session's actual provider/model
  captured from `request/context` events; plugin config acts as fallback only.
- Self-ignoring design: `deepjit_*` tools are excluded from trace collection,
  mining, and flow validation, preventing JIT self-compilation loops.

### Fixed
- `tool/result` callId resolution (nested in `message.source`) and recursive
  extraction of nested `tool-result` text blocks.
- LLM transport failures caused by string message content — messages now use
  `ContentBlock[]` arrays; transient failures retried with backoff.
- `skills/change` subscription moved to the Cordis event bus (`ctx.on`).
- In-flight JIT runs are awaited before closing the store on plugin unload.

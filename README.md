# DeepJIT

JIT 编译插件 for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh)。

仿照 JVM JIT 的语义：持续采集 agent 执行的 trace，识别反复出现的"热点"流程，用 LLM 把它们编译为可复用资产 —— **skill**（markdown 指令）或 **flow**（JSON 步骤模板）—— 并自动回馈给当前 dsh（无需重启）。

## 工作原理

```
session/event + tools/result ──► SQLite 紧凑 trace 索引（~/.dsh/deepjit/deepjit.db）
                                     │
                        ctx.interval（默认 10min）
                                     ▼
                 热点挖掘：工具序列 n-gram + 意图关键词
                                     ▼
                 JIT 编译：从 JSONL 会话日志下钻原文 → LLM 输出严格 JSON
                                     ▼
         skill → ~/.dsh/deepjit/skills/<name>/SKILL.md（filesystem provider 热加载）
         flow  → ~/.dsh/deepjit/flows/<name>.json（deepjit_flow 工具执行）
```

- **精简落库**：只存用户消息、assistant 最终文本、工具调用（参数/结果/tool_ms）、turn/step 边界、时间戳、usage；不存逐 token chunk 与 reasoning。JIT 编译时才通过 `ctx.sessionPersistence.readFrom/readRaw` 从 JSONL 下钻取原文。
- **隔离**：所有产物都在 `~/.dsh/deepjit/`，不碰顶层 `~/.dsh/skills/` 与项目 skill 目录；skill 名统一 `deepjit-` 前缀。
- **自动生效**：skill 写文件即被 skill-filesystem 的 watcher 热发现（机制 A）；若 A 不可用则运行时 `ctx.skills.register` 兜底（机制 B）。
- **权限不变**：flow 的每一步通过 `ctx.tools.execute` 执行，照常走 `tools/pre-execute` 权限闸门。

## 安装

### 开发模式（本地加载）

```sh
npx @deepseek-ai/dsh web --patch ./cordis.patch.yml
```

### Bundle 模式（安装到 profile）

```sh
dsh plugin --profile web add .          # 从本目录安装
dsh --profile web --dump-config         # 验证 deepjit 层已加载
```

## 配置（cordis.patch.yml 或 profile patch 中覆盖）

| 配置项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `dbPath` | `~/.dsh/deepjit/deepjit.db` | SQLite 路径 |
| `flushIntervalMs` | `200` | trace 批写间隔 |
| `flushBatchSize` | `200` | 批写行数上限 |
| `maxResultChars` | `4000` | 工具结果/参数截断长度 |
| `summarizeIntervalMs` | `600000` | JIT 周期（挖掘+编译） |
| `minNewTraces` | `20` | 触发编译的最小新增 trace 数 |
| `minIntervalMs` | `300000` | 两次编译的最小间隔 |
| `llmProvider` | `deepseek-official` | 总结用 provider |
| `llmModel` | （必填） | 总结用模型，如 `deepseek-chat` |
| `minRepeat` | `3` | 热点序列最少出现次数 |
| `ngramMin` / `ngramMax` | `2` / `4` | 序列窗口 |
| `topK` | `5` | 每轮最多编译的候选数 |
| `skillDir` / `flowDir` | `~/.dsh/deepjit/...` | 产物目录 |
| `feedbackMode` | `auto` | 回馈机制选择 |
| `stepTimeoutMs` | `120000` | flow 单步超时 |
| `flowTimeoutMs` | `600000` | flow 总超时（预留） |

## Agent 可用的工具

- **`deepjit_status`**：`list` / `show` / `disable` / `enable` / `delete` 管理已编译产物。
- **`deepjit_flow`**：执行 flow 模板，`{flow, args}`；步骤参数用 `"${input.x}"` 模板绑定，支持点路径。

## 开发

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test（Node 24 内置）
npm run build       # 产出 dist/ 供 bundle 分发
```

## 限制

- dsh 处于快速迭代的 developer preview；npm 上的 `@deepseek-ai/dsh-*` 服务包为早期 rc 版本，与仓库 master 可能存在 API 差异，已锁定版本并在 `src/index.ts` 做了防御性适配。
- `cordis.patch.yml` 中的 `skill-filesystem` 配置行是整行覆盖，base bundle 升级后如该插件新增配置需复查合并。
- flow 步骤中的原生工具在 `mode='code'` 会话中可能被拒（UNKNOWN_TOOL），请使用 native 工具模式或改用 skill。
- LLM 输出非 JSON / 幻觉工具名会被校验丢弃并重试一次。

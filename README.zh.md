<p align="center">
  <img src="assets/banner.jpeg" alt="DeepJIT banner" width="800">
</p>

# DeepJIT

[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 JIT 编译插件。

[English](README.md) | 中文

## 概述

DeepJIT 持续采集 agent 执行 trace，挖掘反复出现的"热点"流程，用 LLM 编译为
可复用的 **skill**（markdown）或 **flow**（步骤模板），并自动回馈给运行中的
dsh，无需重启。适合经常重复相似多工具工作流、希望 dsh 把它们沉淀为可复用资产的人。

```
trace ──► SQLite ──► 热点挖掘 ──► LLM 编译 ──► skill / flow ──► dsh
```

- 产物存放在 `~/.dsh/deepjit/`，自动热加载进 dsh。
- JIT 不编译自己的工具，避免自噬循环。
- 生命周期（编译器式）：AOT pass 对照实时工具注册表校验 flow 并常量折叠字面参数；
  分层（tiering）把高频可靠的 skill 升级为 flow、对不可靠 flow 去优化；GC 剪枝过期产物。

## 兼容性

| 项 | 值 |
|---|---|
| DSH 版本 | `@deepseek-ai/dsh` `0.1.0-rc.8`（运行级验证） |
| DSH mainline | `141eb6fe`（2026-08-19 静态核对，所用 API 无变化） |
| 验证 commit | `5869674`（2026-08-13） |
| Node | `^22.19 \|\| >=24` |
| 适用 profile | `headless`、`web` |

dsh 处于预发布阶段，API 可能变化；依赖 pin 到 `@deepseek-ai/*` `0.1.0-rc.6`。

## 安装 / 卸载

```sh
# 安装（git 直装，无需 npm 发布）
dsh plugin --profile web add github:fly3366/DeepJIT

# 从某个 profile 移除
dsh plugin --profile web remove deepjit

# 彻底删除本地数据
rm -rf ~/.dsh/deepjit
```

## 快速开始

```sh
dsh plugin --profile headless add github:fly3366/DeepJIT
DEEPSEEK_API_KEY=... dsh --profile headless "读取 package.json 和 tsconfig.json 并总结"
# 重复类似任务，deepjit 会自动挖掘并编译热点流程
dsh --profile headless "用 deepjit_status 列出已编译产物"
```

## 配置

在 `cordis.patch.yml` 或 profile patch 中覆盖。主要配置项（完整列表见
[`src/config.ts`](src/config.ts)）：

| 配置 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `summarizeIntervalMs` | `600000` | JIT 周期（挖掘+编译） |
| `minRepeat` | `3` | 热点序列最少出现次数 |
| `argumentAware` | `false` | 挖掘序列中加入排序后的参数键签名 |
| `minFlowSteps` | `2` | 可编译流程的最少工具步数 |
| `minPatternValue` | `6` | 触发编译的最小价值分（`count × steps`） |
| `flushBatchSize` | `200` | 每批写入 SQLite 的 trace 行数 |
| `maxPendingCalls` | `10000` | 内存 pending/raw 映射上限（约束内存） |
| `minerMaxRows` | `20000` | 每会话每挖掘周期最多读取的 trace 行数 |
| `transcriptMaxRows` | `2000` | 每次编译转录最多读取的工具行数 |
| `gcEnabled` / `gcStaleMs` / `gcProtectMs` | `true` / 14天 / 1天 | GC：宽限期后禁用超过 `gcStaleMs` 未用的产物 |
| `dryRun` | `false` | 产物以禁用态发布，需经 `deepjit_status` 手动启用 |
| `traceRetentionMs` / `patternRetentionMs` | 7天 / 7天 | 剪枝超期的 trace 行 / 未编译 pattern |
| `deoptMinUses` / `deoptMaxSuccessRate` | `5` / `0.5` | 使用≥N 次且成功率≤此值的 flow 被禁用（去优化） |
| `qualityMinUses` / `minQuality` | `5` / `0` | 使用≥N 次且质量分<minQuality 的活跃产物被禁用（0=关） |
| `promoteMinUses` / `promoteMinSuccessRate` | `5` / `0.8` | 高频且可靠的 skill 其 pattern 重编译为 flow（升级） |
| `llmProvider` / `llmModel` | `deepseek-official` /（跟随会话） | 编译模型；留空=复用会话模型 |
| `locale` | `auto` | `en` / `zh` / `auto`（dsh locale → `LANG` → 英文） |

敏感项：不存储任何密钥。编译调用走 dsh 凭据服务或启动环境的 `DEEPSEEK_API_KEY`。

## 权限与数据

- **文件**：只写 `~/.dsh/deepjit/`（SQLite trace、skill、flow、日志）；
  编译下钻时通过 `ctx.sessionPersistence` 读取会话 JSONL。
- **网络**：LLM 调用走 dsh 的 `ctx.llm`（DeepSeek provider），无其他网络访问。
- **凭据**：不存储，由 dsh 或环境解析。
- **用户数据**：存储紧凑执行 trace（工具参数/结果、消息文本）。
- **工具**：flow 每步走 `ctx.tools.execute` 与正常权限闸门。
- **可观测**：dsh 的 OTel 遥测只覆盖 agent 会话；DeepJIT 自维护计数器
  （trace 刷写、编译、LLM 时延、GC/deopt/升级）。用
  `deepjit_status {action:"metrics"}` 查看。

## 故障排查

- 日志：`~/.dsh/deepjit/deepjit.log`；数据库：`~/.dsh/deepjit/deepjit.db`。
- `MISSING_CREDENTIAL` → 导出 `DEEPSEEK_API_KEY` 或在 dsh Models 页保存。
- 编译时 `TRANSPORT`/`NO_ADAPTER` → 多为 LLM 瞬时失败；deepjit 会重试并在下个周期兜底。
- 回滚：`dsh plugin --profile <p> remove deepjit`，再 `rm -rf ~/.dsh/deepjit`。

## 开发

```sh
npm install && npm test     # node:test，Node 类型剥离原生运行
npm run typecheck && npm run build
```

见 [CONTRIBUTING.md](CONTRIBUTING.md)、[AGENTS.md](AGENTS.md)。

## 许可与安全

[MIT](LICENSE)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

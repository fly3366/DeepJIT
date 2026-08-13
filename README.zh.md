<p align="center">
  <img src="assets/banner.jpeg" alt="DeepJIT banner" width="800">
</p>

# DeepJIT

[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 JIT 编译插件。

[English](README.md) | 中文

DeepJIT 持续采集 agent 执行 trace，挖掘反复出现的"热点"流程，用 LLM 编译为
可复用的 **skill**（markdown）或 **flow**（步骤模板），并自动回馈给运行中的
dsh，无需重启。

```
trace ──► SQLite ──► 热点挖掘 ──► LLM 编译 ──► skill / flow ──► dsh
```

- 产物存放在 `~/.dsh/deepjit/`，自动热加载进 dsh。
- 编译复用当前会话实际使用的模型；flow 每步仍过权限闸门。
- JIT 不编译自己的工具，避免自噬循环。

## 安装

```sh
dsh plugin --profile web add github:fly3366/DeepJIT
```

## 工具

- `deepjit_status` — 查看 / 禁用 / 启用 / 删除已编译产物。
- `deepjit_flow` — 以 `{flow, args}` 重放已编译流程。

## 开发

```sh
npm install && npm test
```

全部配置项（周期、阈值、locale、路径）见 [`src/config.ts`](src/config.ts)。
另见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)、[AGENTS.md](AGENTS.md)。

## 许可

[MIT](LICENSE)

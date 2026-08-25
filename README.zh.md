# dsh-turnsnap

[DeepSeek Harness (DSH)](https://github.com/search?q=deepseek+harness) 的零配置每轮 git 快照。每个 agent 回合结束后，如果该会话的工作目录是一个有未提交改动的 git 仓库，TurnSnap 会自动 `git add -A` 并创建一个带 `[turnsnap]` 标签的提交——一个你从不需要开口要的回滚点。

## 为什么

长会话会改动大量文件。某一轮跑砸了，你要么手动翻 `git`，要么丢失现场。TurnSnap 把检查点变成自动的：每轮一个提交，提交信息带轮次、文件数和时间：

```
[turnsnap] turn 12 · 7 files · 14:32:08
```

## 安装

```sh
dsh plugin --profile <你的-profile> add dsh-turnsnap
```

零配置、无浏览器端、无需审批：宿主半区几秒内热载，随即开始守护所有处于 git 工作区的会话。

## 工作原理

- 监听 harness 的 `agent/turn-stopping` 事件。
- 从 `agent.session.header.cwd` 解析会话工作目录。
- 目录不是 git 仓库或工作树干净时静默跳过。
- 否则执行 `git add -A && git commit -m "[turnsnap] turn N · M files · HH:MM:SS" --no-verify`。
- 所有快照在一条内部队列上串行执行：父会话和子代理同时结束回合也不会竞争 git index。
- git 通过 harness shell 服务运行；宿主暴露沙箱策略解析器时，每个请求都会盖上所属会话现行文件策略的戳。

## Agent 工具

| 工具 | 作用 |
| --- | --- |
| `turnsnap_pause` | 暂停自动快照，直到 resume |
| `turnsnap_resume` | 恢复自动快照 |
| `turnsnap_status` | 报告开关状态、计数器和最近一次检查点 |

三个工具都零参数。对话里直接说"暂停 turnsnap"，或在任何能调用 harness 工具的脚本里自己调。

## 注意事项

- `git add -A` 会把已暂存但未提交的内容一并收进检查点。如果你刻意保持部分暂存跨回合存在，请先 pause。
- 被忽略的文件仍然被忽略（`add -A` 遵守 `.gitignore`）。
- 提交使用 `--no-verify`，pre-commit 钩子不会在快照上运行。
- 每仓库每回合一个检查点：共享同一工作区的子代理会落进同一个提交。

## 许可证

MIT

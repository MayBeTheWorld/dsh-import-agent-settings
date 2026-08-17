# dsh-import-agent-settings

**导入智能体设置** —— 在「设置 → 通用设置」新增一行"导入智能体设置"，弹出带遮罩的居中卡片，从 **Claude Code / Cursor / Codex / cc-switch** 一键导入 **MCP 服务器**与 **Skills** 到 DeepSeek Harness。

> 开发者预览（0.1.0）。社区插件，MIT 协议，与 DeepSeek 无隶属关系。

## 为什么

Codex CLI 自带 `/import`，能把 Claude Code / Cursor 的配置一键导进 Codex；DSH 一直缺这个等价物。本插件补上：**通用设置里的一行** → 居中弹窗 → 每个来源卡右侧**滑动开关**（开=变亮选中，关=灰暗排除）→ 展开勾选类别 → **先预演、后确认写入**。

## 特性

- **来源自动检测** —— 扫描 `~/.claude`、`~/.cursor`、`~/.codex` 以及 cc-switch（`~/.cc-switch/cc-switch.db`，用 Node 内置 sqlite 直读），报告各工具装了什么。
- **多来源开关选择** —— 每个来源卡一个 toggle；关=排除，开=包含。默认全开 = 一键全导。
- **类别勾选** —— 每个来源下：MCP 服务器、Skills；指令/memory/模型供应商按**能力级检测**如实标注（DSH 原生读 `CLAUDE.md`/`AGENTS.md`；记忆由匹配到能力的社区插件注入——不写死任何插件名，fork 或换名也能命中）。
- **两步安全** —— 先**预演**（dry-run 报告，不写文件），看清单后**确认写入**。
- **MCP → 官方组合层** —— 服务器以 `@deepseek-ai/dsh-mcp-client` 行写入 profile 的 `cordis.patch.yml`（无管理插件 / Hanihahaha 式 UI 插件 / 未来官方 UI 通用）；`~/.dsh/mcp.json`（zebbkira 式 UI）为 auto 检测的备选落点。
- **Skills → `~/.dsh/skills`** —— SKILL.md 目录复制（幂等，已存在跳过）。
- **自动备份** —— 每次写入前目标文件留 `.bak-<时间戳>`。
- **能力级提示** —— 如"记忆：未检测到处理该能力的插件；本插件不导入此项" / "模型路由：由已加载插件「dsh-cc-switch」处理"。

## 来源 × 类别矩阵

| 来源 | MCP | Skills | 指令 | 模型供应商 | 记忆 | 会话 |
|---|---|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ℹ️ 原生读取 | — | ℹ️ 由桥插件 | ⛔ |
| Cursor | ✅ | ✅ | ℹ️ | — | ℹ️ | ⛔ |
| Codex | ✅ (TOML) | ✅ | ℹ️ 原生读取 | — | ℹ️ | ⛔ |
| cc-switch | ✅ (sqlite) | ✅ | — | ℹ️ 由切换插件 | ℹ️ | ⛔ |

- ✅ 可导入 · ℹ️ 检测+提示（本插件不导入） · ⛔ 不支持

## 安装

```powershell
# 从 npm（发布后）
dsh plugin --profile web add dsh-import-agent-settings
# 或本地目录
dsh plugin --profile web add "D:\path\to\dsh-import-agent-settings"
```

然后打开 **设置 → 通用设置 → 导入智能体设置**。

包声明了 `dsh.bundle.patch` + `dsh.client`，`dsh plugin add` 会把它 reconcile 进 profile 的 `dsh.profile.bundles` 层，浏览器半区由 `/plugins/dsh-import-agent-settings/client.js` 提供。新 bundle 延迟后热挂载；host 模块代码改动需重启 `dsh web`。

## 使用

1. 设置 → 通用设置 → **导入智能体设置**。
2. 弹窗列出检测到的来源，每卡右侧**开关**（默认全开）。
3. 展开来源卡 → 勾选类别（MCP / Skills …）。
4. **导入所选（预演）** —— 看 dry-run 报告（已导入 / 跳过 / 说明）。
5. **确认写入** —— 正式落盘（先备份）。

## 架构

```
双面插件（一个 bundle 行 + dsh.client 声明）
├─ lib/index.js   host 半区 — /api/dsh-import/sources + /api/dsh-import/run（loopback 护栏）
├─ lib/import.js  纯业务 — 来源扫描、多格式解析（mcpServers JSON、Codex TOML、
│                 cc-switch sqlite）、MCP→patch / Skills→~/.dsh/skills
└─ lib/client.js  browser 半区 — settings.general.item 行 → 居中 Modal → 开关卡片 →
                  类别勾选 → 预演 → 确认
```

路由 loopback-only；写入前自动 `.bak` 备份；导入幂等（同名服务器/Skills 跳过）。

## 同类社区插件对比

- **dsh-import**（cms19859230182-lang）—— Claude/Codex/Cursor 的 MCP + rules + hooks，设置**一级页**（settings.section）。无 cc-switch、无 Skills 复制、单选来源。
- **dsh-movein**（sjh9714，0.3.x）—— 目前最成熟的搬家工具：CLI + 工具、默认预演、`doctor` + `restore`、凭证安全（`${VAR}` → `!!js process.env.VAR`）。聚焦 Claude Code。

本插件差异化：**通用设置内行**、**多来源开关**、**cc-switch sqlite 全量来源**（providers/MCP/skills/prompts，目前没人做）、**Skills 复制**、**能力级插件检测**。暂不迁移 hooks / 斜杠命令 / 会话——那些请配 dsh-claude-move / dsh-chat-import。

## 已知限制

- MCP 凭据（env/headers）明文写入 `cordis.patch.yml` / `~/.dsh/mcp.json`，注意文件权限；`${VAR}` 引用尚未转成 `!!js process.env.VAR`（dsh-movein 做了，注意源配置里的明文 token）。
- 服务器名须 `[A-Za-z0-9_-]{1,32}` 且全局唯一；`sse`/`ws` transport 跳过并告警。
- 暂无 `doctor` / `restore` 命令——回滚靠 `.bak` 文件手动处理。
- 客户端为手写 lazy-CJS bundle（无构建步骤），仅依赖 `react` 与 `slots` 客户端服务。

## 开发

```bash
node --check lib/import.js && node --check lib/index.js && node --check lib/client.js
# 来源扫描 + dry-run 导入（不写文件）：
node --experimental-sqlite -e "
import('./lib/import.js').then(m => {
  console.log(JSON.stringify(m.detectSources(), null, 1).slice(0, 2000))
  console.log(JSON.stringify(m.runImport([{source:'claude-code',categories:['mcp']}],{target:'patch',dryRun:true}), null, 1).slice(0, 800))
})"
```

## 协议

MIT

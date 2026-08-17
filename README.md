# dsh-import-agent-settings

**Import agent settings into DeepSeek Harness** — one-click migration of MCP servers and Skills from **Claude Code / Cursor / Codex / cc-switch** into DSH, from a row inside **Settings → General → 导入智能体设置**.

> Developer preview (0.1.0). Community plugin, MIT licensed, not affiliated with DeepSeek.

## Why

Codex CLI ships an `/import` that pulls Claude Code / Cursor config into Codex. DSH had no equivalent. This plugin fills that gap with a **General-settings row** that opens a centered modal: pick which agents to import (right-side toggle switches, ON = highlighted, OFF = greyed out), expand a source to tick categories, **preview first, confirm to write**.

## Features

- **Source auto-detect** — scans `~/.claude`, `~/.cursor`, `~/.codex` and cc-switch (`~/.cc-switch/cc-switch.db` via Node's built-in sqlite) and reports what each one carries.
- **Multi-source toggle selection** — one toggle per agent card; off = excluded, on = included. Default all-on = one-click import-all.
- **Category checkboxes** — per source: MCP servers, Skills; instructions/memory/providers are detected and annotated honestly (DSH natively reads `CLAUDE.md`/`AGENTS.md`; memory is injected by capability-matched community plugins — capability detection, never hard-coded plugin names).
- **Two-step safety** — **预演 (preview) first, dry-run report only; 确认写入 (confirm) then writes**.
- **MCP → official composition layer** — servers land as `@deepseek-ai/dsh-mcp-client` rows in the profile's `cordis.patch.yml` (works with no manager plugin, Hanihahaha-style UI plugins, and future official UIs); `~/.dsh/mcp.json` (zebbkira-style UI) is the auto-detected alternative target.
- **Skills → `~/.dsh/skills`** — SKILL.md directories copied (idempotent, skips existing).
- **Backup** — every target file gets a `.bak-<timestamp>` before modification.
- **Capability-aware notes** — e.g. "记忆：未检测到处理该能力的插件；本插件不导入此项" / "模型路由：由已加载插件「dsh-cc-switch」处理" — detects the actually-loaded plugin by capability, works with forks and differently-named plugins.

## Sources × categories

| Source | MCP | Skills | Instructions | Providers | Memory | Sessions |
|---|---|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ℹ️ native-read | — | ℹ️ by bridge plugin | ⛔ |
| Cursor | ✅ | ✅ | ℹ️ | — | ℹ️ | ⛔ |
| Codex | ✅ (TOML) | ✅ | ℹ️ native-read | — | ℹ️ | ⛔ |
| cc-switch | ✅ (sqlite) | ✅ | — | ℹ️ by switch plugin | ℹ️ | ⛔ |

- ✅ importable · ℹ️ detected + annotated (not imported by this plugin) · ⛔ not supported

## Install

```powershell
# from npm (once published)
dsh plugin --profile web add dsh-import-agent-settings
# or from a local checkout
dsh plugin --profile web add "D:\path\to\dsh-import-agent-settings"
```

Then open **Settings → General → 导入智能体设置**.

The package declares `dsh.bundle.patch` + `dsh.client`, so `dsh plugin add` reconciles it into the profile's `dsh.profile.bundles` layer and serves the browser half at `/plugins/dsh-import-agent-settings/client.js`. New bundles hot-mount after a short delay; host module code changes need a `dsh web` restart.

## Usage

1. Settings → General → **导入智能体设置**.
2. The modal lists detected sources with **right-side toggle switches** (default on).
3. Expand a source card → tick categories (MCP / Skills …).
4. **导入所选（预演）** — read the dry-run report (imported / skipped / notes).
5. **确认写入** — applies for real (backup first).

## How it works

```
dual-face plugin (one bundle row + dsh.client declaration)
├─ lib/index.js   host half — /api/dsh-import/sources + /api/dsh-import/run (loopback-only guard)
├─ lib/import.js  pure logic — source scan, multi-format parsing (mcpServers JSON, Codex TOML,
│                 cc-switch sqlite), MCP→patch / Skills→~/.dsh/skills
└─ lib/client.js  browser half — settings.general.item row → centered Modal → toggle cards →
                  category checkboxes → preview → confirm
```

Routes are loopback-only; every write is preceded by a `.bak` backup; imports are idempotent (same-name servers/skills skipped).

## Similar community plugins

- **dsh-import** (cms19859230182-lang) — Claude/Codex/Cursor MCP + rules + hooks into a Settings **page** (settings.section). No cc-switch, no Skills copy, single-source.
- **dsh-movein** (sjh9714, 0.3.x) — the most mature mover: CLI + tool, dry-run by default, `doctor` + `restore`, credential-safe `${VAR}` → `!!js process.env.VAR`. Claude-Code-focused.

This plugin differentiates on: **General-settings row placement**, **multi-source toggles**, **cc-switch sqlite source** (providers/MCP/skills/prompts — nobody else reads it), **Skills copy**, and **capability-based plugin detection**. It does **not** (yet) migrate hooks, slash commands, or sessions — pair with dsh-claude-move / dsh-chat-import for those.

## Limitations

- MCP credentials (env/headers) are written in plaintext to `cordis.patch.yml` / `~/.dsh/mcp.json`; mind file permissions. `${VAR}` refs are **not** yet converted to `!!js process.env.VAR` (unlike dsh-movein) — watch for that in your sources.
- Server names must match `[A-Za-z0-9_-]{1,32}` and be globally unique; `sse`/`ws` MCP transports are skipped with a warning.
- No `doctor` / `restore` command yet — rollback is manual via the `.bak` files.
- Client is a hand-written lazy-CJS bundle (no build step), depending only on `react` and the `slots` client service.

## Development

```bash
node --check lib/import.js && node --check lib/index.js && node --check lib/client.js
# source scan + dry-run import (no writes):
node --experimental-sqlite -e "
import('./lib/import.js').then(m => {
  console.log(JSON.stringify(m.detectSources(), null, 1).slice(0, 2000))
  console.log(JSON.stringify(m.runImport([{source:'claude-code',categories:['mcp']}],{target:'patch',dryRun:true}), null, 1).slice(0, 800))
})"
```

## License

MIT

# dsh-claude-code

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">Drive DSH sessions with Claude Code, trajectory live-streamed</b><br /><br />
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a><br /><br />
  <img alt="live trajectory" src="https://img.shields.io/badge/-live%20trajectory-4d6bfe" /> <img alt="permission bridge" src="https://img.shields.io/badge/-permission%20bridge-4d6bfe" /> <img alt="zero-config" src="https://img.shields.io/badge/-zero--config-4d6bfe" /><br /><br />
  <b>DSH only ships DeepSeek</b>. Add <a href="https://github.com/Yuki-takuya-kun/dsh-engine-switch">dsh-engine-switch</a> + this plugin,<br />
  and a "Claude Code" preset appears — pick it for Claude Code, anything else for DeepSeek.
</div>

<div align="center">
  🌏 <a href="./README.md">中文</a> · <a href="./README_EN.md"><b>English</b></a>
</div>

## ✨ What it does

- **🎯 Plug Claude Code in**: registers a `claude-code` engine (`ClaudeCodeAgent` + preset), routed by [dsh-engine-switch](https://github.com/Yuki-takuya-kun/dsh-engine-switch) with zero config.
- **📡 Live trajectory**: text, thinking, tool calls and results stream into the DSH session in real time.
- **📊 Visible context usage**: Claude Code's token usage and model context window are written into the DSH session log (`TokenUsage` + `request/context`), so the UI shows the context-usage ratio just like DSH native.
- **🔐 Permission bridge**: DSH's sandbox mode + approval policy map onto Claude's permission callback (in-workspace edits allowed, outside prompts for approval); `AskUserQuestion` is answered through DSH's choice UI.
- **🧰 Tools and sandbox come from Claude Code**: the preset is only a routing key — DSH's persona / tools are not forwarded.
- **⏯️ Precise resume**: the Claude session id is side-persisted, so continuing a session reuses the same Claude session.
- **🌐 Subagents stay DeepSeek**: regardless of what the main session picked.

> 🔌 **In one line**: this plugin does **not** replace the main loop itself — it only defines a `claude-code` engine, and hands "preset → engine" routing, switching and resume to dsh-engine-switch. The preset is only a routing key: pick it, and tools / sandbox / persona all come from Claude Code; DSH keeps the log and UI.

## 🚀 Install

**Install [dsh-engine-switch](https://github.com/Yuki-takuya-kun/dsh-engine-switch) first** (it provides the `ctx.engineSwitch` service this plugin depends on; peer deps aren't auto-installed):

```sh
dsh plugin --profile web add github:Yuki-takuya-kun/dsh-engine-switch \
  && dsh plugin --profile web add github:Yuki-takuya-kun/dsh-claude-code
```

Requirements: pnpm on PATH, and a working claude CLI (logged in) or `ANTHROPIC_API_KEY`.

## ⚙️ Enable

Edit `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-engine-switch
  config:
    enabled: true
    # optional: claude-code engine options:
    engines:
      claude-code:
        executable: claude
        # env: { ANTHROPIC_API_KEY: sk-... }  # when not logged in
```

Restart the web app. A "Claude Code" preset appears: pick it → Claude Code, anything else → DeepSeek.

## ⚙️ Config

These are options for the claude-code engine, written under dsh-engine-switch's `config.engines["claude-code"]`:

| Key | Default | Meaning |
|---|---|---|
| executable | "claude" | Claude Code executable (path or PATH name) |
| persistSession | true | reuse the same Claude session across turns |
| includePartialMessages | true | token-level streaming |
| env | {} | extra env (e.g. ANTHROPIC_API_KEY) |

## 🔍 How it works (optional)

- In `apply()`, this plugin calls `ctx.engineSwitch.register(claudeCodeEngine)` to register the `claude-code` engine (`inject: ["engineSwitch"]`).
- Each turn runs Claude Code; SDK events are translated into DSH session events (turn / step / assistant / tool, …), streamed live.
- Permissions are bridged via the `canUseTool` callback: in-workspace writes auto-allow, outside prompts; `AskUserQuestion` uses DSH's choice UI.

## 📄 License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party components.

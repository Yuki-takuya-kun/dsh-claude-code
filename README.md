# dsh-claude-code

Register **Claude Code** as a pluggable **engine** for DeepSeek Harness (DSH) top-level sessions via [dsh-engine-switch](https://github.com/Yuki-takuya-kun/dsh-engine-switch), streaming its full trajectory — text, thinking, tool calls and results — into the DSH web UI in real time.

> 🚧 **PRE-RELEASE — NOT YET USABLE.** Early work-in-progress. Authentication and other paths are not yet validated end-to-end. Do not use in production.

## What it does

This bundle does **not** replace the main loop itself. It only defines a `claude-code` engine (`ClaudeCodeAgent` + `presets/claude-code/`) and registers it with `dsh-engine-switch` via `ctx.engineSwitch`. The latter owns the "preset → engine" routing, blank-session switching, and resume.

With both bundles installed, a **"Claude Code" preset** appears in the picker: **selecting it → Claude Code, anything else → DeepSeek**. Claude Code keeps its own tools/sandbox; DSH keeps the session log and UI, and every step is streamed live.

## Install

`dsh-engine-switch` must be installed **first** — it provides the `ctx.engineSwitch` service this plugin peer-depends on (peer dependencies are not auto-installed):

    # one-liner: engine-switch first, then this plugin
    dsh plugin --profile web add github:Yuki-takuya-kun/dsh-engine-switch \
      && dsh plugin --profile web add github:Yuki-takuya-kun/dsh-claude-code

Requirements: pnpm on PATH, and a working claude CLI (installed + authenticated) or an ANTHROPIC_API_KEY.

## Enable

Edit ~/.dsh/profiles/web/cordis.patch.yml:

    - id: dsh-engine-switch
      config:
        enabled: true
        # engine private config (optional):
        engines:
          claude-code:
            executable: claude
            # env: { ANTHROPIC_API_KEY: sk-... }  # when not logged in

Restart the web app. A "Claude Code" preset appears: select it → Claude Code, anything else → DeepSeek. Subagents always stay DeepSeek; resume re-derives the engine from the log's current preset.

## How it works

- `dsh-claude-code` defines the `claude-code` engine and registers it in `apply()` via `ctx.engineSwitch.register(claudeCodeEngine)` (`inject: ["engineSwitch"]`).
- `dsh-engine-switch` routes: `engineByPreset` hit > engine's own preset (id == engine id) > `defaultEngine`; blank-session preset switch swaps the engine; resume re-derives via `resolveSessionPreset` (reads the log).
- `ClaudeCodeAgent`: implements the dsh-agent `Agent` contract (Inbox/status/cancel), runs Claude Code per turn.
- SDK events → DSH session events (turn/start → step/start → assistant/chunk → assistant/message → tool/call → tool/result → step/end → turn/end), streamed live.
- Permissions are bridged to DSH: the session's `sandbox/mode` + `approval/policy` presets map onto the SDK `canUseTool` callback (`workspace-write` auto-allows in-workspace edits and prompts for outside paths, `danger-full-access` bypasses Claude permissions); `AskUserQuestion` is answered via the DSH choice UI. The Claude session id is side-persisted for precise resume.

## Engine private config (under dsh-engine-switch's `config.engines["claude-code"]`)

| key | default | meaning |
|---|---|---|
| executable | "claude" | Claude Code executable (path or PATH name) |
| persistSession | true | reuse the Claude session across turns |
| includePartialMessages | true | token-level streaming |
| env | {} | extra env (e.g. ANTHROPIC_API_KEY) |

## Limitations

- Pre-release: auth and other paths are not yet validated end-to-end.
- A preset is only a routing key: its DSH tools and persona are not forwarded to Claude Code.
- `AskUserQuestion` is answered through the DSH choice UI (the SDK's headless dialog path is not used).
- Requires a working claude CLI.

## License

MIT. See THIRD_PARTY_NOTICES.md for third-party components.

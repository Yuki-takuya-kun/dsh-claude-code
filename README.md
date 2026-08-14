# dsh-claude-code

Run **Claude Code's harness** as the **DeepSeek Harness (DSH) main loop**, streaming its full trajectory — text, thinking, tool calls and results — into the DSH web UI in real time.

> 🚧 **PRE-RELEASE — NOT YET USABLE.** This is an early work-in-progress. Authentication and several other features are **not yet implemented or verified**, and it has not been validated end-to-end. **Do not use in production.** It may not work out of the box without additional setup.

## What it does

Normally DSH drives every session with its own DeepSeek agent loop. This bundle swaps that driver: when enabled, **new top-level sessions** are driven by the local **Claude Code** CLI (via the official Claude Agent SDK) instead. Claude Code keeps its own tools/sandbox; DSH keeps the session log and UI, and every Claude Code step is written back as DSH session events so the trajectory view shows it live.

## Install

    dsh plugin --profile web add github:Yuki-takuya-kun/dsh-claude-code
    # or from a local checkout:
    dsh plugin --profile web add /path/to/dsh-claude-code

Requirements: pnpm on PATH, and a working claude CLI (installed + authenticated) or an ANTHROPIC_API_KEY.

## Enable

Edit ~/.dsh/profiles/web/cordis.patch.yml:

    - id: dsh-claude-code
      config:
        enabled: true
        # executable: /path/to/claude   # default resolves claude from PATH
        # env: { ANTHROPIC_API_KEY: sk-... }  # optional, when not logged in

Restart the web app. New sessions are now Claude Code. Set enabled: false + restart to return to DeepSeek.

## How it works

- Replaces the agent factory when enabled.
- New top-level sessions → ClaudeCodeAgent (runs Claude Code per turn).
- Subagents and resumed sessions → delegated back to the DeepSeek loop (v1).
- SDK events → DSH session events (turn/start → step/start → assistant/chunk → assistant/message → tool/call → tool/result → step/end → turn/end), streamed live.
- Permission prompts are bridged to the DSH approval UI.

## Configuration

| key | default | meaning |
|---|---|---|
| enabled | false | drive new sessions with Claude Code |
| executable | "claude" | Claude Code executable (path or PATH name) |
| persistSession | true | reuse the Claude session across turns |
| includePartialMessages | true | token-level streaming |
| env | {} | extra env (e.g. ANTHROPIC_API_KEY) |

## Limitations

- Pre-release: resuming a Claude session falls back to DeepSeek.
- AskUserQuestion is disabled; permission prompts use the DSH approval UI.
- Requires a working claude CLI.

## License

MIT. See THIRD_PARTY_NOTICES.md for third-party components.

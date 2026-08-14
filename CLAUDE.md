# CLAUDE.md

dsh-claude-code —— 让 Claude Code 的 harness 作为 DeepSeek Harness 主循环、轨迹实时透传的插件。

## Documentation sync

After making a large/logic change — anything that alters what a doc under
`docs/` claims the system does (a user-facing capability, command, button, or
state added/removed/renamed; a control flow, state machine, clustering/routing
rule, or data contract changed; a documented behavior reversed) — update the
affected docs in the same workflow, then bump `last_synced_commit` in
`docs/index.md` and add a `docs/log.md` entry. Skip this for small bug fixes,
internal refactors with no behavior change, and comment/test/type-only edits.
When unsure whether a change is user-visible, treat it as large: a stale doc
is costlier than an unnecessary sync.

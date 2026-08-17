# CLAUDE.md

dsh-claude-code —— 让 Claude Code 的 harness 作为 DeepSeek Harness 主循环、轨迹实时透传的插件。

## Worktree development

所有开发（代码与文档改动）必须在 git worktree 中进行，禁止直接在 `main`（或默认分支）上提交。开始改动前先创建 worktree——用 `EnterWorktree` 工具或 `git worktree add` 切到独立工作树与分支；在 worktree 内开发、测试、提交，完成后合并回 `main`。

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

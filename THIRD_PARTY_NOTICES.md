# Third-Party Notices

This project depends on third-party components whose terms apply to their
redistribution and use. They are listed here for transparency.

## @anthropic-ai/claude-agent-sdk

- Version: 0.3.220
- Publisher: Anthropic

This project invokes the official Claude Agent SDK to drive the local claude
CLI. The SDK and its bundled Claude Code CLI payload are distributed by
Anthropic and are subject to Anthropic's own license and distribution terms;
they are NOT covered by this project's MIT license. Redistributing this
project therefore does NOT grant redistribution rights over the SDK/CLI
payload — the end user must obtain Claude Code through Anthropic's own
channels and accept its terms.

- The SDK depends on @anthropic-ai/sdk (Anthropic's API client), also
  distributed by Anthropic under its own terms.

See the upstream packages for their exact license text:
- https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- https://www.npmjs.com/package/@anthropic-ai/sdk

---

All other code in this repository is licensed under the MIT License
(see LICENSE).

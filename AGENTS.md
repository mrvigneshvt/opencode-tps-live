# AGENTS.md — opencode-tps-live

Live TPS/AVG/TTFT meter plugin for the OpenCode TUI, published as
`@vixyz/opencode-tps-live`. GitHub: `mrvigneshvt/opencode-tps-live`.

## Layout

- `src/measure.ts` — pure math (window, estimates, calibration). No OpenCode
  imports; unit-tested.
- `src/tui.tsx` — the plugin: V2 session events → `prompt.footer.status` slot.
  TUI-only module shape `{ id, setup }`, plain object (verified loadable on
  OpenCode 2.0.30).
- `src/measure.test.ts` — bun tests.

## Dev loop

- `bun test` before any change claim.
- `bun build src/tui.tsx --external '*' --outfile /tmp/tui-check.js` as the
  syntax/JSX gate.
- No runtime deps. `@opentui/*` and `solid-js` are peers, resolved from the
  OpenCode host — do not add bundled dependencies.

## Verify a release

`bun test` → `npm publish --dry-run` → publish →
`opencode plugin add @vixyz/opencode-tps-live` → restart TUI → run a streaming
prompt and watch the footer. The install-back test is mandatory: it is the
only check for OpenCode's npm-cache module resolution.

## Rules

- No auto-commit; owner approves commits. Conventional Commits.
- Keep the plugin dependency-free; boring over clever.
- gh: pushing needs `gh auth switch -u mrvigneshvt` first (machine default
  active account is vixyz-work).

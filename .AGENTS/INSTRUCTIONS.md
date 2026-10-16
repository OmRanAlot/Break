# Consolidated Agent Instructions

## Project identity

Break (also referred to as Breqk in older notes) is a React Native Android
digital-wellbeing app. It monitors selected apps, adds intentional pauses,
intervenes in supported short-form feeds, supports modes and schedules, and
keeps reflection data on device.

## Required working practices

- Read `context/docs/TASKS.md` before making changes and update task tracking
  after completing work.
- Prefer the code-review-graph MCP tools for repository exploration, impact
  analysis, call tracing, and review.
- Start graph work with minimal context, use minimal detail by default, and
  escalate only when needed.
- Reuse existing code and patterns. Add abstractions only when they are used
  at least three times.
- Add or update logging using the conventions in `context/docs/LOGGING.md`.
- Preserve type safety, validate inputs, surface errors explicitly, and avoid
  silent fallbacks.
- Make focused changes, avoid unrelated cleanup, and validate with the
  smallest relevant build or test command.
- Do not expose credentials or commit secrets.

## Standard commands

```bash
npm start
npm run android
npm run lint
npm test
npm run test:jest
npm run test:static
```

## Architecture summary

The main flow is:

```text
React Native UI -> VPNModule / SettingsModule -> native monitoring and
accessibility services -> Android system APIs
```

Important native areas include the bridge, monitoring, foreground service,
preferences, mode management, and accessibility-based short-form detection.
The app has two monitoring owners in some flows, so blocked-app changes must
keep both monitor instances synchronized.

## Graph-first exploration

Use `mcp.json` to enable `code-review-graph`. Relevant operations include:

- minimal context and graph statistics for orientation
- semantic search for symbols
- callers/callees/importers and test relationships
- impact radius and affected flows
- change detection and review context
- refactor previews before applying renames

Fall back to file search only when graph coverage is insufficient.

## Instructions by source

The complete original guidance is preserved under `sources/`:

- `sources/claude/CLAUDE.md`
- `sources/github/agents/`
- `sources/cursor/agents/`
- `sources/root/.cursorrules`
- `sources/root/.windsurfrules`
- `sources/root/.opencode.json`
- `sources/root/.mcp.json`
- `sources/docs/agents/`

The original plans, skills, hooks, settings, ADRs, task tracker, and logging
dictionary are also preserved in their corresponding directories.

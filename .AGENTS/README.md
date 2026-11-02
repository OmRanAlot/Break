# DoomScrollStopper Agent Context

This folder is the consolidated, repository-local source of truth for agent
guidance, skills, MCP configuration, plans, project context, and workflow
documentation.

## Layout

| Path | Contents |
| --- | --- |
| `INSTRUCTIONS.md` | Consolidated operating guidance from the repository's agent files and rules |
| `mcp.json` | Consolidated MCP server configuration |
| `agents/` | Canonical copies of the repository's custom agents |
| `skills/` | Claude skills for debugging, exploration, refactoring, and review |
| `plans/` | Existing implementation and investigation plans |
| `hooks/` | Agent lifecycle hooks |
| `configuration/` | Claude settings and other tool configuration |
| `context/` | README, task tracking, logging, workflow, ADRs, and other project docs |
| `sources/` | Provenance-preserving copies grouped by their original location |

## Precedence

When guidance conflicts, use this order:

1. The user's request and repository safety requirements.
2. `INSTRUCTIONS.md` and the current project documentation in `context/`.
3. The applicable task-specific skill in `skills/`.
4. A matching implementation plan in `plans/`.
5. Historical or tool-specific source material under `sources/`.

## Source coverage

The consolidated package includes authored material from:

- `.claude/` (excluding generated `worktrees/`)
- `.github/`
- `.cursor/`
- `.cursorrules`, `.windsurfrules`, `.opencode.json`, and `.mcp.json`
- `README.md`
- `docs/`

Files under `sources/` are retained with their original names and relative
grouping so that guidance can be traced back to its original tool or document.
Identical custom agents are represented once under `agents/` and retained in
their original source copies.

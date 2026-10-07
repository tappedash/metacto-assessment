# Orchestration

## Parent critical path
01 audit → 02 shared → 03 pages → 04 verify (all in parent session)

## Packets
- 01-audit: read-only, parent
- 02-shared: write styles.css, app.js, parent
- 03-pages: write index/customer/pm/engineer/admin.html, parent
- 04-verify: manual checklist, parent

## Delegation
None. Reason: coupled shared files; no independent packet worth an agent.

## Agents
None spawned.

## Delegation limits
0 agents, 0 waves.

## Wait points
None.

## Fallback
N/A (workflow mode chosen deliberately).

## Verification order
Click-path audit → skill pre-delivery checklist → confidentiality spot check. No automated tests (user request).

# Open Questions & Decision Log

## Decisions made now

1. **Base platform:** Pi (extensions + SDK), no Pi fork.
2. **Execution model:** CLI-first with optional daemon, mobile/web later.
3. **Initial integrations:** GitHub, Jira, Slack only.
4. **Safety:** mutating actions require approval by default.
5. **Memory:** local-first, event-sourced + indexed retrieval.

## Open questions

1. Preferred embedding backend for vectors?
   - Option A: local lightweight model
   - Option B: provider embeddings
   - Option C: defer vectors and use FTS first

2. What is the canonical “repo identity” for 30+ repos?
   - directory path
   - git remote URL
   - logical project name mapping

3. How should work/personal boundaries be enforced?
   - separate memory namespaces?
   - separate credential sets?

4. Approval UX preference in tmux:
   - inline prompts
   - proposal queue command
   - keybinding-driven quick actions

5. Daemon scheduling cadence:
   - every 5 min vs event-driven triggers

## Suggested next decisions (before implementation)

1. Finalize source priority for v1 (`github`, `jira`, `slack`).
2. Pick SQLite schema and migration strategy.
3. Define policy file format (`policies.toml`).
4. Decide vector strategy (phase 1.0 vs 1.1).
5. Choose first two “golden workflows” for end-to-end demo.

# Task Log

- [x] Read documentation and understand project goals.
- [x] Create initial `tasklog.md`, `findings.md`, and `agents.md`.
- [x] Initialize Phase 0: Foundation.
    - [x] Create Pi package scaffold (`extensions/`, `skills/`, `prompts/`).
    - [x] Initialize local config/state directories.
    - [x] Implement basic policy engine.
- [ ] Initialize Phase 1: Cross-repo memory + federated search.
    - [x] Build adapter wrappers with deterministic parsing (GitHub, Jira, Slack mocks).
    - [x] Add `/search` command and normalized output.
    - [ ] Add event log and SQLite persistence for memory.
    - [ ] Add `/memory add` and `/memory find` commands.
    - [ ] Add `/repo profile` command.

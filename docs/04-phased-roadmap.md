# Phased Roadmap (Start Small, Scale Gradually)

## Phase 0 — Foundation (Week 1)

### Objective
Create project skeleton and safe execution baseline.

### Deliverables
- Pi package scaffold:
  - `extensions/work-agent/`
  - `skills/work-agent/`
  - `prompts/work-agent/`
- Local config/state directories initialized.
- Basic policy engine (read-only default, mutating blocked unless approved).

### Exit criteria
- Extension loads reliably in Pi.
- `/work-agent status` command works.
- Tool-call gate blocks forbidden mutating operations.

---

## Phase 1 — Crucial MVP: Cross-repo memory + federated search (Weeks 2–3)

### Objective
Deliver immediate daily utility for context gathering.

### Deliverables
- Adapter wrappers:
  - `search_github` (via `gh`)
  - `search_jira` (via `jira`)
  - `search_slack` (via `slackline`)
- Unified `/search` command with source filters.
- Memory event log + SQLite index (FTS first, vectors optional in 1.1).
- Repo profile extraction command (`/repo profile`).

### Exit criteria
- One command retrieves cross-source results with links.
- Memory survives restarts and can be queried.
- At least 3 real daily workflows replaced by agent command(s).

---

## Phase 2 — Proposal engine + inbox triage (Weeks 4–5)

### Objective
Turn raw signals into ranked, actionable suggestions.

### Deliverables
- Signal normalization (`WorkSignal`) for Jira/Slack/GitHub.
- Proposal queue with statuses (`new/approved/rejected/executed`).
- `/triage` and `/proposals` commands.
- Daily summary prompt template.

### Exit criteria
- Agent produces useful triage suggestions from live data.
- User can approve/reject proposals in CLI.

---

## Phase 3 — Controlled execution loop (Weeks 6–7)

### Objective
Execute approved operations safely and verify outcomes.

### Deliverables
- `/approve <proposal-id>` flow.
- Post-action verification step (re-fetch object after mutation).
- Structured audit log (`approvals.jsonl`).

### Exit criteria
- Mutating actions require explicit approval.
- Success/failure and verification are logged and inspectable.

---

## Phase 4 — Always-on daemon mode (Weeks 8–9)

### Objective
Run periodic polling/triage without manual prompting.

### Deliverables
- SDK-based background daemon.
- Poll schedules + dedup state.
- Optional tmux status indicator.

### Exit criteria
- Daemon continuously updates proposal queue.
- Restart-safe behavior with no duplicate flood.

---

## Phase 5 — Expanded integrations (Weeks 10+)

### Potential additions
- Mail/Calendar (Microsoft stack)
- Confluence search and page summarization
- DevOps integrations (ArgoCD, Spacelift, AWS)
- Sonar and LivingDocs deeper automation
- Mobile/web view for proposals and approvals

---

## Sequencing rules (do not break)

1. Never add broad automation before approval controls are stable.
2. Prefer one high-quality integration over three shallow ones.
3. Every phase must improve daily usability, not just architecture purity.
4. Keep rollback simple: append-only logs + deterministic adapters.

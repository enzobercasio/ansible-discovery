# Automation Discovery Canvas — How to Use

A quick guide to running a discovery session with the canvas: map a cross-team
process, score it, spot the handoffs, and export a spec your AAP / SDD-Ansible
pipeline can build from.

## The layout

- **Left panel** — Teams (lanes) manager and the node palette.
- **Centre** — the canvas: horizontal swimlanes, one per team.
- **Right panel** — four tabs: **Edit** (inspector), **Backlog**, **Handoffs**, **Export**.
- **Header** — process name, Example loader, Clear, and the SVG / PDF export buttons.

## 1. Set up the teams (lanes)

Each horizontal lane is a team, and a step's lane is **who owns it**.

- Add a lane with **Add lane**.
- Rename by typing in the lane's name field; click the colour swatch to recolour.
- Remove a lane with the ✕ (its steps move to the first lane).

## 2. Map the process

Add nodes from the palette:

| Node | Meaning | Becomes in AAP |
|------|---------|----------------|
| **Step / Role** | one unit of work | an Ansible role / job template |
| **Approval gate** | a required sign-off | an AAP workflow approval node |
| **Decision** | a branch point | `when:` conditions |
| **External dependency** | a system another team owns that you consume or report to but won't automate this pass | an EDA event / API / manual touchpoint |
| **Trigger / Terminus** | where the flow starts / ends | workflow bounds |

- **Move** a card by dragging it.
- **Change owner** by dragging a card into another lane.
- **Connect** two cards by pulling from the dot on a card's right edge onto the target card.

## 3. Type the dependencies

Select an edge (click it) and choose its type in the inspector:

- **Sequence** — the target simply runs after the source.
- **Data** — the target needs an artifact produced by the source; name it
  (e.g. `instance_id`, `cidr_block`). The artifact appears on the arrow.

Any edge touching an **External** node is shown as an external dependency.
**Every arrow that crosses a lane is a handoff** — the point where work leaves one
team and enters another.

## 4. Score suitability (Step nodes)

Select a Step and mark its **Current status** — Manual or Automated — so the
canvas, Backlog, and every export show what's already automated versus what
still needs work. New steps default to Manual.

Then set the four sliders (1–5):

- **Frequency** — how often it runs
- **Standardisation** — how rule-based it is
- **Error-proneness** — manual error risk today
- **Effort** — how hard it is to automate (weighted *down*)

The result is a 2–10 score, banded **Quick win / Plan / Defer**.

**Reusability.** Toggle *Reusable by other teams*, then confirm **both** checks —
"parameterised, no team-specific hard-coding" and "named owner for the shared
version". Only when both are ticked is the role *verified reusable* and promoted
to a quick win (its score is floored at 7.5). A claimed-but-unverified role gets
no promotion.

## 5. Read the analysis

- **Backlog** — every role ranked by suitability, tagged with its owning team and
  flagged `handoff` / `reusable`. This is your prioritised, fundable roadmap.
- **Handoffs** — every cross-team dependency and external dependency, with counts.
- **Metrics** — the Metrics-Based Process Mapping baseline: total process/lead time, activity ratio (share of lead time actually spent working), and rolled %C&A (compounded first-pass quality). Set each step's metrics in the Edit tab.
  This is the coordination map: each row is wait-time your automation removes.

## 6. Export

- **PDF** / **SVG** (header) — the whole diagram, for a deck or customer follow-up.
- **YAML** (Export tab) — the AAP workflow spec: roles with owners, `depends_on`,
  `consumes`, `reusable`; plus `approvals`, `external_dependencies`, `handoffs`,
  and a topologically ordered `workflow`.
- **UML activity (PlantUML)** (Export tab) — a UML Activity Diagram view: swimlanes per team, actions per step, scores and MBPM metrics as notes. Render at plantuml.com or any PlantUML tool.
- **JSON Schema** (Export tab) — validate the spec in CI so every session yields a
  consistent input for the SDD-Ansible generation step.

## 7. Hand off to the automation advisor agent

Once you've exported a `.spec.yml`, run Claude Code from this repo and invoke
the **process-automation-advisor** agent (`.claude/agents/process-automation-advisor.md`)
on it — e.g. *"use the process-automation-advisor agent on
`app_deploy_current.spec.yml`"*. It applies Lean / Theory of Constraints / Six
Sigma / MBPM to every role and writes a to-be `*.automated.spec.yml` (re-import
it here to keep editing visually) plus a `*.automation-recommendations.md`
report: before/after metrics, per-role automate-or-not rationale, an
illustrative cost-savings calculation, and a phased Ansible rollout plan.

## How the spec maps to AAP

- team / lane → AAP organisation + team + RBAC
- `workflow` array → an AAP workflow job template
- approval node → an AAP workflow approval node
- external EDA dependency → a rulebook event source
- `reusable: true` role → publish to a shared collection / automation hub

## Keyboard & controls

- **Delete / Backspace** — remove the selected node or edge
- **Esc** — cancel a connection in progress
- **Clear** (header) — empty the canvas but keep the lanes (two-step confirm)
- **Import** (header) — load an existing workflow spec (`.yml`) back onto the canvas to revise it; positions are auto-laid-out from the workflow order and lanes
- **Example** (header) — load the EC2-hosted or S3 + CloudFront sample

## Running it in a workshop

- Do it live. Watching tribal knowledge turn into lanes, then a ranked backlog,
  lands harder than any slide.
- **Count the lane crossings** — that number is the coordination cost, and the
  ROI argument for automating the handoff.
- Keep **External** nodes honest — they define what you are *not* automating this
  pass, which stops a session from over-committing.
- Export the YAML at the end; that is the artifact the rest of the pipeline consumes.

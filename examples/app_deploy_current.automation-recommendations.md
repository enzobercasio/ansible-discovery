# Automation Recommendations — app_deploy_current

Source spec: `app_deploy_current_spec.yml` → to-be spec: `app_deploy_current.automated.spec.yml`

## Executive summary

The current EC2 deployment process is entirely manual and ticket-driven: 7 roles across 4 teams, 6 of 7 crossing a team boundary as a handoff, and 1,290 minutes of lead time to do 185 minutes of actual work (a 14.3% activity ratio — 86% of the process is waiting). Automating 6 of the 7 roles and partially automating the 7th cuts total lead time to 127 minutes (**90% faster end-to-end**), lifts the activity ratio to 31.5%, and raises compounded first-pass quality (rolled %C&A) from 17.1% to 84.9%. One required governance step (security review) is kept, but the request feeding it is streamlined so it spends less time waiting to be reviewed.

## Methodology

**Lean (waste elimination).** Every one of the six `handoffs` in the current spec is a wait state: a ticket sits in a queue until the next team picks it up. `provision_ec2_instance` alone carries 435 minutes of the 1,290-minute total lead time as pure queue wait (480 lead time vs. 45 process time). Automating the trigger — an API call instead of an ITSM ticket — removes that queue entirely rather than making the human step faster.

**Theory of Constraints.** `provision_ec2_instance` (480 min lead time) and `raise_firewall_request`→`security_review` (90 min + review turnaround) are the two largest wait pools on the critical path. Both get direct attention in the to-be design: provisioning becomes a fully automated, reusable role; the firewall request becomes API-generated so the reviewer sees it sooner. No effort was spent optimising `manual_smoke_test`'s wait time beyond its own automation, since it isn't the bottleneck.

**Six Sigma (quality).** Current `pct_complete_accurate` ranges from 70–85% — meaning up to 30% of runs need rework. That compounds: rolled across all 7 steps, only 17.1% of runs go through cleanly today. Automation's real quality lever is determinism (the same idempotent playbook runs the same way every time), which is why every fully-automated role jumps to 97–99%.

**MBPM.** The spec's own `baseline` block is the before/after scorecard: total process time, total lead time, activity ratio, and rolled %C&A, recomputed below from the to-be spec's per-role metrics.

## Before / after comparison

| Metric | Current | To-be | Δ | % change |
|---|---:|---:|---:|---:|
| Total process time (min) | 185 | 40 | −145 | −78% |
| Total lead time (min) | 1,290 | 127 | −1,163 | −90% |
| Activity ratio | 14.3% | 31.5% | +17.2pp | +120% |
| Rolled %C&A | 17.1% | 84.9% | +67.8pp | +396% |
| Total resources (headcount) | 7 | 6 | −1 | −14% |
| Roles automated / total | 0 / 7 | 6 / 7 | +6 | — |
| Cross-team handoffs | 6 | 1 | −5 | −83% |

## Per-role recommendations

| Role | Band / score | Decision | Rationale |
|---|---|---|---|
| `raise_infra_ticket` | quick_win / 8.0 | Automate fully | High frequency, low complexity; replace manual ITSM form with an API-created request triggered by the deployment event. |
| `provision_ec2_instance` | quick_win / 8.3 | Automate fully | The single largest wait pool (435 min) in the current process — the Theory-of-Constraints bottleneck. Becomes a reusable, parameterised role. |
| `raise_firewall_request` | plan / 7.4 | Automate assisted | Just under the quick-win threshold; standardisation is good but not yet verified reusable. Auto-generate the request via API, keep a human check on the rule set before it reaches review. |
| `configure_firewall` | quick_win / 7.6 | Automate fully | High error-proneness (5/5) today — a strong Six Sigma case: a deterministic playbook removes the manual-entry defect source. |
| `deploy_application` | quick_win / 8.3 | Automate fully | High frequency and standardisation; already the shape of a CI/CD deploy role. |
| `update_cmdb` | quick_win / 8.8 | Automate fully | Highest score in the backlog; trivial complexity (1/5). Trigger via an EDA event on successful deploy — zero human resources required. |
| `manual_smoke_test` | quick_win / 8.0 | Automate fully | Convert the checklist into an automated test suite; kept slightly below 99% %C&A (97%) since some exploratory checks still add value. |

## Handoff & governance changes

- 5 of the current 6 cross-team handoffs disappear because the steps either merge into one automated flow or trigger the next step directly (API/EDA) instead of via a ticket queue.
- The **security review** approval is kept unchanged — it's a governance requirement, not a process inefficiency, and removing it would trade compliance for speed. The one remaining handoff (`raise_firewall_request` → `security_review`) is intentionally left as a real human wait.
- Recommended addition (not yet reflected in the spec's `approvals` block, since the schema doesn't model pre-checks): an automated policy/compliance scan on the firewall request *before* it reaches the reviewer, so obviously-non-compliant requests are rejected in seconds rather than after a review-cycle round trip.

## Estimated cost savings

```
hours_saved_per_run   = (old_process_time − new_process_time) / 60
                       = (185 − 40) / 60
                       = 2.42 hours/run

annual_hours_saved    = hours_saved_per_run × runs_per_year
annual_savings        = annual_hours_saved × loaded_hourly_rate
```

Runs/year and loaded hourly rate aren't in the spec — substitute your own. As a **worked, illustrative example only** (50 deployments/year, $75/hr blended loaded rate):

```
annual_hours_saved = 2.42 × 50           = 121 hours
annual_savings     = 121 × $75           ≈ $9,060/year
```

The labor-hour saving is real but secondary here — the bigger win is **lead time**: dropping from ~21.5 hours to ~2.1 hours per deployment means the business gets the *outcome* (a live environment) 90% faster, independent of headcount cost.

## Ansible implementation roadmap

**Phase 1 — quick wins (build first, highest score):**

| Role | Suggested Ansible role name | Likely collection / modules |
|---|---|---|
| `update_cmdb` | `cmdb_update` | REST call via `ansible.builtin.uri`, or `servicenow.itsm` if ServiceNow-backed |
| `provision_ec2_instance` | `aws_ec2_provision` | `amazon.aws` (`amazon.aws.ec2_instance`, `amazon.aws.ec2_vpc_subnet_info`) |
| `deploy_application` | `app_deploy` | Depends on the app; typically `ansible.builtin.*` + your artifact store's collection |
| `raise_infra_ticket` | `infra_ticket_create` | `servicenow.itsm.api` or a direct `ansible.builtin.uri` call to your ITSM's REST API |
| `configure_firewall` | `firewall_configure` | `ansible.builtin.uri` / vendor collection depending on the firewall platform |
| `manual_smoke_test` | `app_smoke_test` | `ansible.builtin.uri` + `ansible.builtin.assert`, or a test-runner wrapper |

**Phase 2 — assisted automation:**

| Role | Suggested Ansible role name | Note |
|---|---|---|
| `raise_firewall_request` | `firewall_request_create` | Automate the request creation; keep the human review gate downstream unchanged |

**Phase 3:** none — every role in this process cleared the quick-win or plan bar, so there's no defer-band work to schedule later.

**Build and rollout guardrails:**

1. Build each Phase 1 role with Molecule tests and run it in `--check` (check-mode) mode against a real environment before enabling it for real changes.
2. Pilot the reusable roles (`update_cmdb`, `provision_ec2_instance`, `deploy_application`, `configure_firewall`, `raise_infra_ticket`, `manual_smoke_test`) with one team before publishing to the shared automation hub — they're flagged `reusable: true` in the to-be spec specifically because they're parameterised with no team-specific hard-coding.
3. Wire the to-be `workflow` array into an AAP workflow job template in the same order it's listed, with `security_review` as a workflow **approval** node exactly where it appears.
4. Add an EDA rulebook that fires the `update_cmdb` job template on successful completion of `deploy_application` — this is what lets `update_cmdb` run with `resources: 0`.

## Assumptions & limitations

- All timing and quality figures originate from the workshop's self-reported estimates in the current-state spec, not measured production data. Validate against real timings before committing a budget to the projected 90% lead-time reduction.
- The projected `pct_complete_accurate` values for the to-be roles (97–99%) assume the automation is built with proper input validation and idempotency; a poorly-tested playbook will not automatically hit these numbers.
- The cost-savings worked example uses illustrative volume (50 runs/year) and rate ($75/hr) — replace both with your organisation's actual figures before using this number externally.

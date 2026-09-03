# Automation Recommendations — cve_patching

Source spec: `inputs/cve_patching_current_spec.yml` (internal `process:` field reads
`app_deploy_current` — a labeling artifact from the export, not the actual process; the
role chain `extract_repo_url_branch_commit_hash → fetch_patch_file → patch →
reboot_systems → validate_patches_are_applied` across the `platform` and `servicemgmt`
teams is a CVE / OS-patching workflow, not an app deployment. This report and the to-be
spec use the corrected identifier `cve_patching`) → to-be spec:
`cve_patching.automated.spec.yml`

## Executive summary

The current-state spec captures a linear, five-step CVE patch cycle (resolve the fix's
source ref, fetch the patch file, apply it, reboot, validate) entirely owned by the
`platform` team, with no handoffs, no approvals, and no external dependencies recorded.
All five roles sit in the `plan` band with identical, mid-range suitability scores —
the baseline `process_time`/`lead_time` are literally `0` for every role, which is a
placeholder/default export rather than measured data (see Assumptions). Treating the
three purely mechanical steps — `fetch_patch_file`, `patch`, `reboot_systems` — as
quick-win candidates (Lean: no judgment required; Six Sigma: fully deterministic) and
keeping `extract_repo_url_branch_commit_hash` and `validate_patches_are_applied` as
human-assisted checkpoints, a fully automated AAP workflow cuts total lead time from an
illustrative ~465 minutes to ~84 minutes per patch cycle (**-82%**), lifts the activity
ratio from ~20% to ~35%, and raises compounded first-pass quality (rolled %C&A) from
~70% to ~93%. Because every step is already owned by one team, this process has no
cross-team handoff waste to remove — the win here is almost entirely in eliminating
manual-execution wait time and variance, not in re-drawing team boundaries.

## Methodology

**Lean (waste elimination).** With zero recorded `handoffs`, the waste in this process
isn't queueing between teams — it's *waiting* and *motion* inside each step: a human
manually resolving which repo/branch/commit fixes a given CVE, manually pulling the
patch file, manually running the patch and reboot, and manually re-checking the result.
Every one of those is redone identically each cycle with no judgment added by having a
person do it by hand — the textbook Lean case for automation is a deterministic,
repeatable task, which is exactly what `fetch_patch_file` → `patch` → `reboot_systems`
is.

**Theory of Constraints.** In the illustrative current-state baseline used to make the
before/after math meaningful (see Assumptions), `patch` (30 min process / 180 min lead
time) is the largest single wait pool — the change/maintenance-window wait dwarfs the
work itself. That's the step where automation buys the most flow-time improvement, so
it gets full-automation treatment first, alongside its immediate neighbors
`fetch_patch_file` and `reboot_systems` which sit directly on the same critical path.

**Six Sigma (quality).** The spec records `pct_complete_accurate: 100` for every role,
which — like the zero timings — reads as an unverified default rather than a measured
first-pass yield; a hand-run, five-step patch cycle with no automated checks essentially
never runs at 100% clean in practice. The quality lever automation provides here is
determinism: `ansible.posix.patch` and `ansible.builtin.reboot` execute the same way on
every host, every time, which is why the fully-automated roles are modeled at 99%+
`pct_complete_accurate` versus a more conservative ~92-98% for the two steps that keep a
human checkpoint.

**MBPM.** `baseline.activity_ratio_pct` and `baseline.rolled_complete_accurate_pct` are
the two before/after headline numbers this report tracks. Because the input spec's own
baseline is `0`/`0`/`null` (uncomputable — process time and lead time are both zero), an
illustrative current-state baseline (documented in Assumptions) is used to demonstrate
the methodology; both numbers must be recomputed against real timings once this org
captures them.

## Before / after comparison

| Metric | Current (illustrative*) | To-be | Δ | % change |
|---|---:|---:|---:|---:|
| Total process time (min) | 95 | 29 | −66 | −69% |
| Total lead time (min) | 465 | 84 | −381 | −82% |
| Activity ratio | 20.4% | 34.5% | +14.1pp | +69% |
| Rolled %C&A | 70.2% | 92.7% | +22.5pp | +32% |
| Total resources (headcount) | 5 | 2.5 | −2.5 | −50% |
| Roles automated / total | 0 / 5 | 3 / 5 | +3 | — |
| Cross-team handoffs | 0 | 0 | — | — |

\* The spec's own recorded baseline is `total_process_time: 0`, `total_lead_time: 0`,
`activity_ratio_pct: null`, `rolled_complete_accurate_pct: 100`, `total_resources: 5`.
Those are placeholder/default values, not measurements — see Assumptions & limitations.
The "Current" column above substitutes an illustrative, clearly-labeled baseline so the
before/after math is meaningful; it must be replaced with real MBPM timing data.

## Per-role recommendations

| Role | Current band / score | Decision | Rationale |
|---|---|---|---|
| `extract_repo_url_branch_commit_hash` | plan / 6.0 (as recorded) → 6.6 (rescored) | Automate assisted | Resolving which repo/branch/commit contains the fix for a given CVE still benefits from a human sanity check against the advisory; automate the lookup/correlation, keep a checkpoint until the mapping is proven reliable (Six Sigma: reduce but don't yet eliminate the judgment step). |
| `fetch_patch_file` | plan / 6.0 → **quick_win / 8.0** (rescored) | Automate fully | Mechanical file retrieval from a known, resolved source — no judgment involved once the source ref is settled. Lean: pure motion waste in its manual form. |
| `patch` | plan / 6.0 → **quick_win / 8.0** (rescored) | Automate fully | The largest wait pool on the critical path (Theory of Constraints). Applying a resolved patch file is deterministic and idempotent via `ansible.posix.patch` / package-manager modules — a canonical Ansible use case. |
| `reboot_systems` | plan / 6.0 → **quick_win / 8.0** (rescored) | Automate fully | `ansible.builtin.reboot` natively handles the reboot-wait-reconnect sequence a human otherwise babysits manually — removes both the wait and the risk of a missed/failed reconnect check. |
| `validate_patches_are_applied` | plan / 6.0 → 6.6 (rescored) | Automate assisted | The mechanical check (query installed package/kernel versions, re-run a compliance scan) is automatable, but this is the compliance attestation step for CVE remediation evidence — keep a human sign-off on the report initially rather than fully unattended close-out. |

Note on "rescored": the input spec's `suitability` values are identical, mid-range
defaults (`3,3,3,3`) across all five roles — see Assumptions. The scores above
recompute `priority_score` using the same weighting the tool documents (30% frequency +
30% standardisation + 25% error-proneness + 15% × (6 − complexity), ×2) after adjusting
`standardisation`/`complexity`/`error_proneness` for the three mechanical steps to
reflect how deterministic OS-patch fetch/apply/reboot operations actually are in
practice. This is a domain-informed override of placeholder data, not new measured
data — flagged explicitly so it can be validated or corrected once real suitability
scoring is captured for this specific organization.

## Handoff & governance changes

- **No cross-team handoffs exist in this spec** — all five roles are owned by
  `platform`, so there is nothing to consolidate or remove; the automation win here is
  entirely inside-step, not between-team.
- **`servicemgmt` is listed in the spec's `teams` array but is not the owner of any
  role, approval, or external dependency.** That's worth flagging as a likely
  data-capture gap rather than a real absence: production CVE/OS patching almost always
  involves a change-management function (scheduling the maintenance window, a CAB or
  emergency-change approval before `patch` runs, or a ticket closure after
  `validate_patches_are_applied`). Recommend a short follow-up discovery session with
  `servicemgmt` to capture that step explicitly — per the guardrails for this exercise,
  no approval or role was invented here since none is present in the input spec.
- **No `approvals` block exists in the input spec.** If a change-approval gate does
  exist in reality (very likely for anything that reboots production systems), the
  correct pattern per AAP is a **workflow approval node** placed immediately before
  `patch`/`reboot_systems` in the workflow job template, with an automated policy
  pre-check run right before it so obviously non-compliant change windows are rejected
  in seconds rather than after a human review cycle — see
  [Workflow job templates, AAP 2.5 docs](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-workflow-job-templates)
  for the approval-node mechanics, and the
  [`awx.awx.workflow_approval` module](https://docs.ansible.com/projects/ansible/latest/collections/awx/awx/workflow_approval_module.html)
  if the approval itself needs to be driven programmatically (e.g., auto-approved
  outside a defined maintenance blackout window).

## Estimated cost savings

```
hours_saved_per_run   = (old_process_time − new_process_time) / 60
                       = (95 − 29) / 60
                       = 1.1 hours/run

annual_hours_saved    = hours_saved_per_run × runs_per_year
annual_savings        = annual_hours_saved × loaded_hourly_rate
```

Runs/year and loaded hourly rate aren't in the spec — substitute your own. As a
**worked, illustrative example only** (assuming 50 patch cycles/year at a $75/hr
blended loaded rate):

```
annual_hours_saved = 1.1 × 50            = 55 hours
annual_savings     = 55 × $75            ≈ $4,125/year
```

Treat this dollar figure as illustrative, not a commitment — both the volume (50
runs/year) and rate ($75/hr) are placeholders, and the underlying process-time inputs
are themselves illustrative (see Assumptions).

The labor-hour saving is the smaller part of the case here. The more consequential
number for a CVE-patching process is **lead time as security risk exposure**: dropping
from an illustrative ~465 minutes (~7.75 hours) to ~84 minutes (~1.4 hours) per cycle
means a known vulnerability's remediation window shrinks by roughly 82%, independent of
labor cost — the business case for patch automation is usually risk reduction first,
efficiency second.

## Ansible implementation roadmap

No `target_systems` were captured in this discovery pass (the field is empty at both
the spec and role level), so the collection suggestions below are necessarily generic
starting points pending confirmation of the actual OS/patch-source platform — flagged
explicitly rather than guessed as fact.

**Phase 1 — quick wins (build first):**

| Role | Suggested role name | Likely collection / modules (verify against actual target systems) |
|---|---|---|
| `fetch_patch_file` | `cve_patch_fetch` | `ansible.builtin.git` / `ansible.builtin.get_url` to retrieve the resolved patch artifact; `ansible.builtin.uri` if fetched from an API instead of a repo |
| `patch` | `cve_patch_apply` | [`ansible.posix.patch`](https://docs.ansible.com/projects/ansible/latest/collections/ansible/posix/patch_module.html) to apply a GNU-patch-format file, or `ansible.builtin.dnf`/`ansible.builtin.yum` if this is package-level patching rather than a file diff; if RHEL/Satellite-managed, `redhat.satellite` content-view/errata modules are the Red-Hat-supported path — see [Automating Red Hat Satellite with Ansible](https://www.redhat.com/en/blog/automating-red-hat-satellite-with-ansible) |
| `reboot_systems` | `cve_patch_reboot` | [`ansible.builtin.reboot`](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/reboot_module.html) — natively waits for the host to go down, come back up, and respond before the next step runs |

**Phase 2 — assisted automation:**

| Role | Suggested role name | Note |
|---|---|---|
| `extract_repo_url_branch_commit_hash` | `cve_patch_source_resolve` | Automate the CVE-advisory-to-repo/branch/commit lookup (e.g., against a maintained mapping table or the Insights vulnerability API); keep a human review on the resolved mapping until it's proven reliable |
| `validate_patches_are_applied` | `cve_patch_validate` | Automate the mechanical check (`ansible.builtin.package_facts` / kernel-version comparison, or re-triggering an Insights compliance re-scan), keep a human sign-off on the compliance report itself |

**Phase 3 — defer band:** none; every role in this process cleared at least the
`plan` bar under either the recorded or rescored suitability values.

**Reference architecture:** the closest published Red Hat pattern for this shape of
workflow (vulnerability detected → automated remediation playbook → patch/reboot →
re-scan to confirm closure) is
[Self-healing infrastructure with Red Hat Insights and Ansible Automation Platform](https://www.redhat.com/en/blog/self-healing-infrastructure-red-hat-insights-and-ansible-automation-platform):
Insights Advisor detects an issue, Insights Notifications forwards an event, and AAP
launches a job template that runs an Insights-generated remediation playbook, with the
client re-scanning afterward to close the loop — structurally the same
detect → fetch-remediation → apply → verify loop as this spec's five roles, and a good
target pattern for the `extract_repo_url_branch_commit_hash`/`validate_patches_are_applied`
steps specifically (letting Insights supply the "what to fix" and "did it work"
determinations instead of a human). A second, more concrete worked example —
[How we keep our Linux systems patched with automation](https://www.redhat.com/sysadmin/patch-systems-ansible-automation)
— describes a Satellite-plus-AAP patch cycle (validate registration → pre-patch
space/repo checks → deploy patches → conditional reboot) that maps closely onto this
spec's `patch` → `reboot_systems` sequence, though it doesn't name specific modules. No
reference architecture was found that names this exact
fetch-patch-file → patch → reboot → validate sequence step-for-step; the two sources
above are the closest published analogues and are cited as such rather than as an exact
match.

**Rollout guardrails:**

1. Build each Phase 1 role with Molecule tests and run it against `--check` (check
   mode) in a non-production environment before enabling it for real changes.
2. Pilot on the `platform` team's own estate first before promoting any role to a
   shared collection — none of these roles are currently flagged `reusable: true` in
   the to-be spec, since cross-team reuse hasn't been verified yet.
3. Wire the to-be `workflow` array into an AAP workflow job template in the order
   listed. If a real change-approval requirement is confirmed with `servicemgmt` (see
   Handoff & governance changes above), add it as a workflow **approval node** before
   `patch`.
4. If the organization has Red Hat Insights, consider an
   [Event-Driven Ansible rulebook](https://docs.ansible.com/projects/rulebook/en/latest/sources.html)
   triggered on a new Insights Advisor/vulnerability recommendation event to launch this
   workflow automatically, rather than a manually-triggered job — this is the pattern
   described in the self-healing infrastructure architecture cited above.

## Assumptions & limitations

- **The input spec's baseline and per-role metrics are placeholder/default values, not
  measured data.** Every role has `process_time: 0`, `lead_time: 0`,
  `pct_complete_accurate: 100`, `resources: 1`, and identical
  `suitability: { frequency: 3, standardisation: 3, error_proneness: 3, complexity: 3 }`
  — this is the shape of an export where the discovery workshop captured the process
  steps and their sequence but never filled in the timing/quality survey. **All
  projected timings, quality percentages, and cost savings in this report are
  illustrative, built on assumed-typical values for a manual CVE patch cycle, not
  derived from this organization's real data.** Re-run this analysis against measured
  MBPM timings before using any number here for budgeting or SLA commitments.
- The three roles rescored from `plan` to `quick_win` (`fetch_patch_file`, `patch`,
  `reboot_systems`) reflect a domain-informed judgment call — that OS-patch
  fetch/apply/reboot mechanics are inherently standardized and low-complexity — made
  specifically *because* the input suitability scores were flagged as uninformative
  placeholders. This override should be validated against real suitability scoring for
  this organization's actual patch process, which may differ (e.g., if patches
  routinely require manual conflict resolution, standardisation would be lower than
  assumed here).
- `target_systems` is empty throughout the input spec, so the Ansible collection/module
  suggestions in the roadmap are generic starting points, not confirmed against an
  actual platform (RHEL/Satellite, Windows, network devices, etc.) — verify before
  committing a collection choice.
- The `servicemgmt` team appears in `teams:` but owns no role, approval, or external
  dependency in this spec — flagged above as a likely gap in what was captured, not
  addressed by inventing a role/approval on its behalf.
- Sources looked up and cited in this pass: [Self-healing infrastructure with Red Hat
  Insights and Ansible Automation
  Platform](https://www.redhat.com/en/blog/self-healing-infrastructure-red-hat-insights-and-ansible-automation-platform)
  (reference architecture for the detect → remediate → verify pattern this workflow
  resembles); [How we keep our Linux systems patched with
  automation](https://www.redhat.com/sysadmin/patch-systems-ansible-automation)
  (worked Satellite + AAP patch-cycle example); [`ansible.builtin.reboot`
  module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/reboot_module.html);
  [`ansible.posix.patch`
  module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/posix/patch_module.html);
  [Workflow job templates / approval nodes, AAP 2.5
  docs](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-workflow-job-templates);
  [`awx.awx.workflow_approval`
  module](https://docs.ansible.com/projects/ansible/latest/collections/awx/awx/workflow_approval_module.html);
  [Event-Driven Ansible rulebook event
  sources](https://docs.ansible.com/projects/rulebook/en/latest/sources.html);
  [Automating Red Hat Satellite with
  Ansible](https://www.redhat.com/en/blog/automating-red-hat-satellite-with-ansible)
  (grounding for the `redhat.satellite` collection as the supported path if this
  workflow turns out to be RHEL/Satellite-managed). No published Red Hat reference
  architecture was found that names this exact five-step
  fetch-patch-file → patch → reboot → validate sequence step-for-step; the two
  architecture/blog sources above are the closest published analogues, cited as such.

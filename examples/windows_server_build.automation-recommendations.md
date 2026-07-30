# Automation Recommendations — windows_server_build

Source spec: `windows_server_build_spec.yml` → to-be spec: `windows_server_build.automated.spec.yml`

## Executive summary

Provisioning a Windows server today touches **6 teams** across **10 roles and 1 change approval**: Service Desk, Platform/Virtualization, Service Management (CAB), Network, Identity/AD, and Security — 12 of the process's edges cross a team boundary. Total lead time is 1,095 minutes (~18.25 hours) to do 190 minutes of actual work (a 17.4% activity ratio). Automating 7 of the 10 roles and consolidating them under one owning team (`platform_automation`) cuts total lead time to 184 minutes (**83% faster end-to-end**), lifts the activity ratio to 29.9%, raises rolled %C&A from 17.5% to 71.8%, and drops handoffs from 12 to 8. The change approval and three specialist judgment steps (capacity check, AD OU/GPO placement, vulnerability triage) are deliberately left for a human.

## Methodology

**Lean (waste elimination).** This is a longer, more fragmented process than a typical app deployment: 10 sequential roles across 6 teams mean 12 of the process's edges are cross-team handoffs — nearly every step waits on a different team to pick up a ticket. `provision_vm_from_template` alone carries 195 minutes of pure queue wait (240 lead time vs. 45 process time), and both `raise_build_request` and `run_vulnerability_scan` carry 160 minutes each.

**Theory of Constraints.** `provision_vm_from_template` (240 min lead time, 195 min of it waiting) is the single largest wait pool and sits early on the critical path — every downstream step queues behind it. It becomes a fully automated, reusable role in the to-be design. The two runner-up wait pools (`raise_build_request`, `run_vulnerability_scan`, 160 min each) are addressed differently: the build request becomes an instant API-created record, while the vulnerability scan is automated to *run* on schedule but keeps a human for triage — automating the trigger removes most of the wait even though the judgment step stays.

**Six Sigma (quality).** `update_cmdb` has the worst current %C&A (75%) despite the lowest complexity (1/5) — a classic case of a trivial, high-frequency, manually-keyed step accumulating data-entry defects. Automating it (an EDA-triggered CMDB update with zero human resources) both removes the defect source and the labor. Rolled across all 10 steps, only 17.5% of builds go through clean today; determinism from idempotent playbooks is what lifts every fully-automated role to 98–99%.

**MBPM.** The `baseline` block in both specs is the before/after scorecard — recomputed directly from each role's `metrics`, not asserted separately.

## Before / after comparison

| Metric | Current | To-be | Δ | % change |
|---|---:|---:|---:|---:|
| Total process time (min) | 190 | 55 | −135 | −71% |
| Total lead time (min) | 1,095 | 184 | −911 | −83% |
| Activity ratio | 17.4% | 29.9% | +12.5pp | +72% |
| Rolled %C&A | 17.5% | 71.8% | +54.3pp | +310% |
| Total resources (headcount) | 10 | 9 | −1 | −10% |
| Roles automated / total | 0 / 10 | 7 / 10 | +7 | — |
| Cross-team handoff edges | 12 | 8 | −4 | −33% |

## Per-role recommendations

| Role | Band / score | Decision | Rationale |
|---|---|---|---|
| `update_cmdb` | quick_win / 9.4 | Automate fully | Highest score, trivial complexity, worst current quality (75% %C&A) — the strongest Six Sigma case in the set. EDA-triggered on build completion, zero human resources. |
| `close_ticket_handover_docs` | quick_win / 8.3 | Automate fully | High frequency, standardised template; auto-generate the handover doc and close the ticket via API. |
| `apply_cis_hardening_baseline` | quick_win / 8.2 | Automate fully | Highest standardisation (5/5) in the set — a textbook reusable role; the same baseline applies to every build. |
| `assign_ip_dns_record` | quick_win / 8.1 | Automate fully | Deterministic, IPAM/DNS-API-drivable; no judgment required once inputs are known. |
| `install_monitoring_agent` | quick_win / 8.1 | Automate fully | Standard install/registration step, identical across builds — reusable. |
| `raise_build_request` | quick_win / 8.0 | Automate fully | High frequency, low complexity; the ticket becomes an API-created record from a self-service form. |
| `provision_vm_from_template` | quick_win / 7.8 | Automate fully | The Theory-of-Constraints bottleneck (195 min of the 240 min lead time is pure wait). Becomes a reusable, parameterised role. |
| `check_cluster_capacity` | plan / 7.2 | Automate assisted | Judgment-heavy (varies by cluster/environment); automate the capacity *check* (query + report) but keep a human decision on marginal cases. |
| `join_ad_domain_ou` | plan / 7.2 | Automate assisted | OU placement and GPO assignment vary by business unit — standardise the mechanics, keep a human confirming the OU path. |
| `run_vulnerability_scan` | plan / 6.9 | Automate assisted | Lowest score in the set; automate the scan trigger and report generation, keep a human on findings triage. |

## Handoff & governance changes

- The 7 fully-automated roles are consolidated under one owning team, `platform_automation` — the team that builds and runs the end-to-end AAP workflow. Handoffs *between* those roles disappear.
- `check_cluster_capacity` (Platform), `join_ad_domain_ou` (Identity), and `run_vulnerability_scan` (Security) keep their original specialist owners because they retain real human judgment — so handoffs into and out of each of those three remain. That's most of the 8 that are left.
- `change_approval_cab` (Service Management) is unchanged — a genuine CAB governance gate, not process waste.
- The `backup_platform` external dependency is upgraded from `integration: manual` to `api` in the to-be spec — recommend confirming your backup platform actually exposes a registration API before committing to this; if it doesn't, leave it `manual` and treat it as a follow-up integration project.

## Estimated cost savings

```
hours_saved_per_run = (190 − 55) / 60 = 2.25 hours/run
annual_hours_saved  = 2.25 × runs_per_year
annual_savings      = annual_hours_saved × loaded_hourly_rate
```

As a **worked, illustrative example only** (50 server builds/year, $75/hr blended loaded rate):

```
annual_hours_saved = 2.25 × 50   = 112.5 hours
annual_savings     = 112.5 × $75 ≈ $8,438/year
```

Substitute your own build volume and rate. As with the app-deploy example, **lead time is the bigger story**: ~18.25 hours down to ~3.1 hours per server, independent of labor cost — that's the difference between "the server will be ready next week" and "the server will be ready this afternoon."

## Ansible implementation roadmap

**Phase 1 — quick wins:**

| Role | Suggested Ansible role name | Likely collection / modules |
|---|---|---|
| `update_cmdb` | `cmdb_update` | `servicenow.itsm` or `ansible.builtin.uri` against your CMDB's REST API |
| `close_ticket_handover_docs` | `build_ticket_close` | `servicenow.itsm.api` or `ansible.builtin.uri` |
| `apply_cis_hardening_baseline` | `windows_cis_hardening` | `ansible.windows` (`ansible.windows.win_*`), paired with a CIS-benchmark role from Ansible Galaxy |
| `assign_ip_dns_record` | `dns_ipam_assign` | `ansible.builtin.uri` against your IPAM/DNS API (e.g. Infoblox, BlueCat), or `community.general.dnsimple` if applicable |
| `install_monitoring_agent` | `windows_monitoring_agent` | `ansible.windows.win_package` / `ansible.windows.win_service`, or a vendor-specific collection for your monitoring platform |
| `raise_build_request` | `build_ticket_create` | `servicenow.itsm.api` or `ansible.builtin.uri` |
| `provision_vm_from_template` | `vsphere_vm_provision` | `community.vmware` (`community.vmware.vmware_guest`) |

**Phase 2 — assisted automation:**

| Role | Suggested Ansible role name | Note |
|---|---|---|
| `check_cluster_capacity` | `vsphere_capacity_check` | `community.vmware.vmware_datastore_info` / `vmware_cluster_info`; report only, human decides on marginal cases |
| `join_ad_domain_ou` | `windows_domain_join` | `microsoft.ad.membership` (or `ansible.windows.win_domain_membership`); parameterise OU path, keep a human confirmation step |
| `run_vulnerability_scan` | `windows_vuln_scan` | Trigger via your scanner's API (`ansible.builtin.uri`); route results to the security team for triage |

**Phase 3:** none — every role cleared the quick-win or plan bar.

**Build and rollout guardrails:**

1. Build each Phase 1 role with Molecule and validate in check-mode against a real (non-prod) vSphere cluster before enabling it for real builds.
2. Pilot the reusable roles (all 7 Phase 1 roles are flagged `reusable: true`) with one team before publishing to the shared automation hub.
3. Wire the to-be `workflow` array into an AAP workflow job template in the order listed, with `change_approval_cab` as a workflow **approval** node exactly where it appears.
4. Add an EDA rulebook that fires `update_cmdb` on successful completion of the build workflow — this is what lets it run with `resources: 0`.

## Assumptions & limitations

- Timing and quality figures are illustrative estimates matching a typical enterprise Windows build, not measured production data for any specific organisation — replace with your own numbers before committing budget.
- The projected %C&A values (98–99%) assume properly tested, idempotent playbooks; a rushed or unvalidated automation will not automatically hit these numbers.
- The cost-savings example uses an illustrative volume (50 builds/year) and rate ($75/hr) — substitute your organisation's actual figures.
- Whether `backup_platform` can genuinely move from `manual` to `api` integration depends on your backup platform's actual API surface — verify before treating that line item as already solved.

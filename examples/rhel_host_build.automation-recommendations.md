# Automation Recommendations — rhel_host_build

Source spec: `rhel_host_build_spec.yml` → to-be spec: `rhel_host_build.automated.spec.yml`

## Executive summary

Provisioning a RHEL host today is the most fragmented process in this set: **11 roles, 1 change approval, 6 teams**, and 13 of the process's edges crossing a team boundary — including RHEL-specific steps (Satellite registration, STIG/SELinux hardening, firewalld zoning) that a generic Windows or app-deploy flow doesn't have. Total lead time is 1,150 minutes (~19.2 hours) against 195 minutes of actual work (a 17.0% activity ratio), and rolled %C&A is the lowest of the three examples at 14.8% — the extra steps compound. Automating 8 of the 11 roles under one owning team (`platform_automation`) cuts lead time to 193 minutes (**83% faster**), lifts activity ratio to 28.5%, raises rolled %C&A to 66.6%, and drops handoffs from 13 to 7.

## Methodology

**Lean (waste elimination).** `provision_vm_from_template` carries 180 of its 220 lead-time minutes as pure wait; `raise_build_request` and `run_vulnerability_scan` each carry 160. With 11 sequential roles across 6 teams, this process has the most cross-team wait of the three examples in this set — every specialist function (virtualization, Linux admin, network, security, service management) touches the host once, in sequence, each behind its own queue.

**Theory of Constraints.** `provision_vm_from_template` (220 min lead time) is the largest single wait pool and the earliest bottleneck — everything RHEL-specific (`register_with_satellite`, hardening, firewalld) queues behind it. It's the first target for automation. `configure_firewalld_zones` (band `plan`, score 7.4) is the process's most error-prone step (error-proneness 4/5) and is deliberately kept partially manual — zone/port rules vary enough by application that a human should confirm them, even though the mechanical `firewall-cmd` application can run unattended.

**Six Sigma (quality).** `update_cmdb` again has the worst quality (75% %C&A) despite trivial complexity — the same manual-data-entry defect pattern as the Windows example. With 11 roles compounding instead of 10, current rolled %C&A (14.8%) is the lowest of the three examples: more steps, more chances for a manual defect to break first-pass completion.

**MBPM.** Both specs' `baseline` blocks are recomputed directly from per-role `metrics` — the numbers below aren't asserted independently of the spec.

## Before / after comparison

| Metric | Current | To-be | Δ | % change |
|---|---:|---:|---:|---:|
| Total process time (min) | 195 | 55 | −140 | −72% |
| Total lead time (min) | 1,150 | 193 | −957 | −83% |
| Activity ratio | 17.0% | 28.5% | +11.5pp | +68% |
| Rolled %C&A | 14.8% | 66.6% | +51.8pp | +350% |
| Total resources (headcount) | 11 | 10 | −1 | −9% |
| Roles automated / total | 0 / 11 | 8 / 11 | +8 | — |
| Cross-team handoff edges | 13 | 7 | −6 | −46% |

## Per-role recommendations

| Role | Band / score | Decision | Rationale |
|---|---|---|---|
| `update_cmdb` | quick_win / 9.4 | Automate fully | Highest score, trivial complexity, worst current quality (75%) — same pattern as the Windows example. EDA-triggered, zero human resources. |
| `close_ticket_handover_docs` | quick_win / 8.3 | Automate fully | High frequency, standardised; auto-close via API. |
| `apply_stig_hardening_selinux_policy` | quick_win / 8.2 | Automate fully | Highest standardisation (5/5) — the STIG/SELinux baseline is identical across builds; a strong reusable-role candidate. |
| `register_with_satellite_attach_content_view` | quick_win / 8.1 | Automate fully | Deterministic once the content view/activation key is known — no judgment required. |
| `assign_ip_dns_record` | quick_win / 8.1 | Automate fully | Same as every other domain in this set — a pure API call once inputs are known. |
| `install_monitoring_agent` | quick_win / 8.1 | Automate fully | Standard install/registration, identical across builds. |
| `raise_build_request` | quick_win / 8.0 | Automate fully | Ticket becomes an API-created record from a self-service form. |
| `provision_vm_from_template` | quick_win / 7.8 | Automate fully | The Theory-of-Constraints bottleneck — 180 of 220 lead-time minutes are pure wait. |
| `configure_firewalld_zones` | plan / 7.4 | Automate assisted | Highest error-proneness (4/5) in the set; automate rule application but keep a human confirming zone/port scope per application. |
| `check_cluster_capacity` | plan / 7.2 | Automate assisted | Judgment-heavy, varies by cluster; automate the check, keep a human on marginal decisions. |
| `run_vulnerability_scan` | plan / 6.9 | Automate assisted | Lowest score; automate the scan trigger, keep a human on findings triage. |

## Handoff & governance changes

- The 8 fully-automated roles consolidate under `platform_automation`, eliminating the handoffs between them.
- `configure_firewalld_zones` (Network), `check_cluster_capacity` (Platform), and `run_vulnerability_scan` (Security) keep their specialist owners — real judgment steps, not paperwork — so the handoffs immediately around each of those three remain, accounting for most of the 7 left.
- `change_approval_cab` (Service Management) is unchanged, same as in the Windows and app-deploy examples — a genuine governance gate.
- The `backup_platform` external dependency is upgraded from `manual` to `api` integration in the to-be spec; confirm your backup platform actually supports API registration before treating this as solved.

## Estimated cost savings

```
hours_saved_per_run = (195 − 55) / 60 = 2.33 hours/run
annual_hours_saved  = 2.33 × runs_per_year
annual_savings      = annual_hours_saved × loaded_hourly_rate
```

As a **worked, illustrative example only** (50 host builds/year, $75/hr blended loaded rate):

```
annual_hours_saved = 2.33 × 50   = 116.7 hours
annual_savings     = 116.7 × $75 ≈ $8,752/year
```

Substitute your own build volume and rate. Lead time is again the headline: ~19.2 hours down to ~3.2 hours per host.

## Ansible implementation roadmap

**Phase 1 — quick wins:**

| Role | Suggested Ansible role name | Likely collection / modules |
|---|---|---|
| `update_cmdb` | `cmdb_update` | `servicenow.itsm` or `ansible.builtin.uri` |
| `close_ticket_handover_docs` | `build_ticket_close` | `servicenow.itsm.api` or `ansible.builtin.uri` |
| `apply_stig_hardening_selinux_policy` | `rhel_stig_hardening` | `ansible.posix` (`ansible.posix.selinux`), paired with a DISA STIG role from Ansible Galaxy or `redhat.rhel_system_roles` |
| `register_with_satellite_attach_content_view` | `satellite_register` | `redhat.satellite` collection, or `community.general.redhat_subscription` for direct subscription-manager |
| `assign_ip_dns_record` | `dns_ipam_assign` | `ansible.builtin.uri` against your IPAM/DNS API |
| `install_monitoring_agent` | `rhel_monitoring_agent` | `ansible.builtin.package` / `ansible.builtin.service`, or a vendor-specific collection |
| `raise_build_request` | `build_ticket_create` | `servicenow.itsm.api` or `ansible.builtin.uri` |
| `provision_vm_from_template` | `kvm_vm_provision` | `community.libvirt` (`community.libvirt.virt`), or your virtualization platform's collection |

**Phase 2 — assisted automation:**

| Role | Suggested Ansible role name | Note |
|---|---|---|
| `configure_firewalld_zones` | `rhel_firewalld_configure` | `ansible.posix.firewalld`; parameterise zones/ports, keep a human confirming scope per application |
| `check_cluster_capacity` | `kvm_capacity_check` | Query via `community.libvirt` info modules; report only |
| `run_vulnerability_scan` | `rhel_vuln_scan` | Trigger via your scanner's API; route results to security for triage |

**Phase 3:** none — every role cleared the quick-win or plan bar.

**Build and rollout guardrails:**

1. Build each Phase 1 role with Molecule and validate in check-mode against a real (non-prod) KVM/virtualization cluster before enabling it for real builds.
2. Pilot the reusable roles (all 8 Phase 1 roles are flagged `reusable: true`) with one team before publishing to the shared automation hub.
3. Wire the to-be `workflow` array into an AAP workflow job template in the order listed, with `change_approval_cab` as a workflow **approval** node exactly where it appears.
4. Add an EDA rulebook that fires `update_cmdb` on successful completion of the build workflow — this is what lets it run with `resources: 0`.

## Assumptions & limitations

- Timing and quality figures are illustrative estimates matching a typical enterprise RHEL build, not measured production data — replace with your own numbers.
- The projected %C&A values (98–99%) assume properly tested, idempotent playbooks.
- The cost-savings example uses an illustrative volume (50 builds/year) and rate ($75/hr) — substitute your organisation's actual figures.
- Whether `backup_platform` can genuinely move from `manual` to `api` integration depends on your backup platform's actual API surface.

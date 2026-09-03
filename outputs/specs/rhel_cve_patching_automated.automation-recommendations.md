# RHEL CVE Patching — Automation Recommendations

**Source spec:** `ansible-discovery/inputs/cve_patching_current_spec.yml` (exported `process: app_deploy_current` — the slug and label text are a leftover from a different canvas export; the actual roles describe a RHEL CVE patching chain, confirmed with the requester)
**To-be spec:** `ansible-discovery/outputs/specs/rhel_cve_patching_automated.spec.yml`

**Revision note:** this report and its accompanying spec were updated after initial delivery to fold in the org's "CVE Patching Automation Framework" and "CVE Source and Reporting Data" requirements — an explicit pre-patch validation step, application-specific stop/start/validate steps, TechLens as a candidate baseline-report source, and an explicit flag that the CVE source/reporting format is not yet finalized. All changes are described inline below; nothing from the first pass was silently dropped.

## Executive summary

The current process is five fully manual, sequentially-dependent steps owned entirely by `platform` — pull repo/branch/commit metadata, fetch the patch file, apply it, reboot, validate — with no automated pre-checks, no governance gate before a service-impacting reboot, and no measured timing data (the exported baseline is literally zero across the board). The to-be design now spans **nine automated steps across three phases** (pre-patching, patching, application validation), adding an explicit pre-patch health check (agent status, filesystem size, kernel version), application-specific stop/start/validate steps sourced from scripts the application team owns, and an expanded post-patch validation that re-checks the same three health signals plus a baseline-report comparison — with exactly one human checkpoint (`patch_readiness_review`, owned by `servicemgmt`) immediately before the reboot. Because the source spec's own timing fields are placeholders, this report again builds a labeled **illustrative estimate** of the equivalent manual effort across all nine steps, purely to show scale: process time drops from ~195 to 45 minutes (‑77%), lead time from ~1,485 to 93 minutes (‑94%), and rolled first-pass quality from ~40% to ~91%. Two integration points remain explicitly open pending sign-off: (1) whether the CVE source feed is Red Hat Insights, the TechLens portal, or something else, and in what format (API vs. CSV); and (2) whether patch content is Satellite-managed rather than the bespoke git-sourced file the role labels currently imply.

## Use case & requirements inputs

- **Use case (confirmed with requester):** RHEL CVE patching for an internal infrastructure fleet — not a formally regulated workflow, but with real availability blast radius because the process includes a system reboot and now application stop/start.
- **Scope directive (confirmed with requester):** end-to-end automation spanning pre-patching, patching, and application validation, with a human go/no-go checkpoint "where appropriate" — placed between `patch` and `reboot_systems`, unchanged from the first pass.
- **CVE Patching Automation Framework (new this revision):**
  - Both pre-patch and post-patch validation must check **agent status, filesystem size, and kernel version**. This is now modeled as a standalone `pre_patch_validation` role (new, before `patch`) and folded into the existing `validate_patches_are_applied` role's expanded scope (label, inputs, and metrics all updated to reflect the added checks), rather than left implicit inside `patch`.
  - **Shenbagaraj GT** intends to adapt established pre-patch/post-patch validation methods for this workflow. He's the named SME/owner for the validation-step design (`pre_patch_validation` and the expanded `validate_patches_are_applied`) going forward — noted here as a contact, not as a spec field, since the schema has no owner/contact attribute on roles.
  - Automation requires application-specific **stop, start, and validate scripts provided by the application team**. Modeled as three new roles (`stop_application`, `start_application`, `validate_application`) plus a new external dependency (`application_lifecycle_scripts`) — see "Design choice: how the application-team scripts are modeled" below for why it's split this way.
- **CVE Source and Reporting Data (new this revision):**
  - **TechLens** portal was raised as a candidate source for vulnerability/baseline reports. I could not find public documentation for a product named "TechLens" — treating it as an internal/organization-specific system name, not a documented Red Hat/Ansible integration. See the modeling decision below.
  - Baseline reports will be used to validate post-patch **configuration compliance** — modeled as a new `baseline_report_source` external dependency feeding `validate_patches_are_applied`, and as a `pre_patch_baseline` artifact consumed from `pre_patch_validation` so the post-patch check has both a pre-patch snapshot and the TechLens baseline report to compare against.
  - **CVE source identification and reporting format (CSV vs. API) is explicitly not finalized.** I have not hard-committed to a specific integration shape in the spec — see "Open decisions" below.
- **Ambiguities I resolved by assumption (carried over / updated):**
  - `target_systems` was empty in the source spec; inferred as `[git, rhel]` in the first pass, now extended to `[git, rhel, techlens]` given the new baseline-report source. Confirm whether patch content actually flows through Red Hat Satellite/Insights errata management instead of a bespoke git-sourced patch file (unchanged open question from the first pass — see Assumptions & limitations).
  - `servicemgmt` still owns only the approval and the change-record dependency; a new `application` team was added to the spec's `teams:` list solely to own the `application_lifecycle_scripts` external dependency (see design choice below), not to imply the application team executes any live step in this workflow.

### Design choice: how the application-team scripts are modeled

The instruction was to use judgment on whether app stop/start/validate is a new team, a role, or an external dependency. I split it: the **execution steps** (`stop_application`, `start_application`, `validate_application`) are modeled as roles **owned by `platform`**, because it's platform's AAP workflow that invokes them on a schedule/trigger with no need for a live application-team handoff on every run. The **script content itself** is modeled as a new external dependency, `application_lifecycle_scripts`, **owned by a new `application` team**, `integration: manual` (the scripts are a deliverable the app team hands over, not yet an automated feed), consumed by all three roles. This keeps the workflow from acquiring cross-team wait time on every patch cycle (which the org didn't ask for) while still correctly attributing script ownership to the application team. If in practice the application team needs to approve *before* their app is stopped each run, that would change this to a second approval node — flag if that's the case.

## Methodology

- **Lean (waste elimination):** On the expanded 9-step illustrative current-state estimate, waiting waste (lead_time − process_time) is ~1,290 of 1,485 minutes (~87%) — still dominated by queueing for a maintenance window, not work. The four new steps add real, necessary work (health checks, app lifecycle management) rather than waste — but if the application team's stop/start/validate scripts don't exist yet or aren't standardized per-app, that step itself becomes a new waiting/rework risk until scripts are actually delivered (see Assumptions & limitations).
- **Theory of Constraints:** `patch` and `reboot_systems` remain the largest illustrative lead-time contributors (480 and 240 min respectively) — still gated on maintenance-window scheduling, not the new validation/app-lifecycle work. The new steps were sized deliberately small in the to-be design (5–9 minutes of automated process time each) specifically so they don't become a new constraint themselves.
- **Six Sigma (quality/determinism):** Splitting "validate" into a distinct `pre_patch_validation` step (captures a real pre-patch baseline: agent status, filesystem size, kernel version) and an expanded `validate_patches_are_applied` (re-checks the same three signals plus a TechLens baseline-report diff) is a direct application of Shenbagaraj GT's stated intent to adapt established pre/post-patch validation methods — comparing an actual "before" state to an actual "after" state, rather than a single point-in-time check, is what makes the quality claim credible rather than assumed.
- **MBPM:** Adding four real steps to the pipeline changes the rolled %C&A math in a way worth calling out explicitly: with 9 automated steps at an illustrative 99% each instead of 5, the *to-be* rolled %C&A is 91.3% — lower than the first pass's 5-step figure of 95.1%, purely because more checkpoints compound. That's expected and still a large improvement over the current-state equivalent (39.8%, itself lower than the first pass's 67.2% for the same reason — more manual steps means more places for something to be missed today). The net direction and magnitude of the improvement doesn't change; the absolute post-automation ceiling naturally comes down slightly as scope grows, which is honest math, not a design flaw.

## Reference architectures considered

Unchanged from the first pass, plus one new note on TechLens:

| Source | Summary | Verdict |
|---|---|---|
| [5 steps to consistently patch RHEL and Windows systems](https://developers.redhat.com/articles/2025/08/01/5-steps-consistently-patch-rhel-and-windows-systems) (Red Hat Developer, 2025) | Phased pattern: dynamic inventory → scheduled job template → patch via `dnf`/`apt` with service pause/resume around the update → compliance validation/reporting. | **Adopted** — the service pause/resume-around-patch idea directly informed adding `stop_application`/`start_application` as explicit steps rather than folding them into `patch`. |
| [Patch updates on RHEL servers with AAP 2.4](https://developers.redhat.com/articles/2024/04/15/patch-updates-rhel-servers-ansible-automation-platform-24) (Red Hat Developer, 2024) | Minimal job-template pattern driven by Insights findings, verifying the vulnerability is resolved post-run. | **Partially adopted** — "verify against the originating vulnerability" reused in `validate_patches_are_applied`; still no approval/governance layer in the original pattern, which this design adds independently. |
| [Reacting to Red Hat Insights CVE advisories with EDA and ServiceNow](https://www.redhat.com/en/blog/red-hat-insights-cve-advisories) (Red Hat blog) | EDA rulebook: Insights webhook source → `new-advisory` condition → `run_job_template` action. | **Adopted as one candidate**, not the only one — now explicitly competing with TechLens as the CVE source (see Open decisions); the trigger *shape* (event → condition → run job template) still applies regardless of which system wins. |
| [Red Hat Satellite Ansible Collection](https://github.com/RedHatSatellite/satellite-ansible-collection) | Content-view/errata-based patch content management. | **Not adopted, still flagged** — unconfirmed whether this org uses Satellite; if so, substitute for the git-sourced `fetch_patch_file`. |
| [AAP workflow job template approval nodes](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-workflow-job-templates) | Native workflow pause-for-approval mechanism. | **Adopted directly** for `patch_readiness_review`, unchanged. |
| [servicenow.itsm collection — `change_request` module](https://github.com/ansible-collections/servicenow.itsm) | Supported module for ServiceNow change-request create/update. | **Adopted conditionally**, unchanged — only valid if the org's ITSM tool is actually ServiceNow. |
| "TechLens portal" (org-named, searched independently) | No public documentation found for a product by this name under a CVE/vulnerability-management or baseline-reporting search. | **Treated as an internal/proprietary system, not a documented reference architecture.** Modeled generically as an API-integration placeholder (`baseline_report_source`, and a candidate for `cve_source_feed`) — no collection can be responsibly named for it until the org confirms what it actually exposes (REST API, exported CSV, or a manual portal). |

## Before / after comparison

The current-state column is again a **labeled illustrative estimate**, now extended to cover the four newly-scoped steps as well (even though the original 5-step export never named pre-patch validation or app lifecycle management separately, the requirements confirm this work needs to happen, formally or informally, every cycle today). Replace with real MBPM timings before treating this as a commitment.

| Metric | As-exported (placeholder) | Illustrative current-state estimate (9-step equivalent) | To-be (projected, 9 automated steps) | Δ | % change |
|---|---|---|---|---|---|
| Total process time (min) | 0 | 195 | 45 | −150 | −76.9% |
| Total lead time (min) | 0 | 1,485 | 93 | −1,392 | −93.7% |
| Activity ratio % | null | 13.1% | 48.4% | +35.3pp | +269.5% relative |
| Rolled %C&A | 100%* | 39.8% | 91.3% | +51.5pp | +129.4% relative |
| Total resources (headcount/run) | 5 | 9 | 1 | −8 | −88.9% |
| Handoff count | 0 | 0 | 2 (new, deliberate — around the approval) | +2 | governance gate, not new waste |
| Roles automated / total | 0 / 5 | 0 / 9 | 9 / 9 | +9 | 100% |

\* The exported 100% rolled %C&A is a default value, not a measurement.

## Per-role recommendations

| Role | Band / priority | Decision | Rationale |
|---|---|---|---|
| `extract_repo_url_branch_commit_hash` | quick_win / 7.9 | **Automate fully** | Unchanged from first pass — deterministic git metadata lookup. |
| `fetch_patch_file` | quick_win / 7.9 | **Automate fully** | Unchanged — file retrieval, no judgment involved. |
| `pre_patch_validation` **(new)** | quick_win / 7.9 | **Automate fully** | New role per the confirmed framework requirement: checks agent status, filesystem size, and kernel version *before* patching, and records a `pre_patch_baseline` artifact for later comparison. Standardised, scriptable fact-gathering (Six Sigma determinism lever). SME: Shenbagaraj GT is adapting the validation methodology this role implements. |
| `stop_application` **(new)** | quick_win / 7.5 | **Automate fully, script-dependent** | Executes the application team's stop script. `reusable: false` — the script content is inherently app-specific even though the pipeline shape is reusable across apps. |
| `patch` | quick_win / 7.6 | **Automate fully (governance gate immediately after)** | Unchanged reasoning — the Theory-of-Constraints bottleneck candidate; now also depends on the app being stopped first. |
| `patch_readiness_review` (approval) | n/a | **Human checkpoint, unchanged** | Still the single highest-blast-radius transition — patch applied, app stopped, about to reboot. |
| `reboot_systems` | quick_win / 7.5 | **Automate fully, approval-gated** | Unchanged — `ansible.builtin.reboot` handles the full lifecycle in one idempotent task. |
| `start_application` **(new)** | quick_win / 7.5 | **Automate fully, script-dependent** | Executes the application team's start script immediately after reboot. `reusable: false`, same reasoning as `stop_application`. |
| `validate_application` **(new)** | quick_win / 7.5 | **Automate fully, script-dependent** | Runs the application team's validate script and produces an `app_health_status` artifact consumed by the final OS-level validation step. |
| `validate_patches_are_applied` **(updated scope)** | quick_win / 7.6 | **Automate fully** | Expanded from a single CVE-applied check to: re-verify agent status/filesystem size/kernel version, compare against the `pre_patch_baseline` artifact and the TechLens `baseline_report_source`, and consume `app_health_status`. Priority score nudged down slightly from the first pass (7.9→7.6) to reflect that the baseline-report integration shape is not yet finalized — still comfortably inside the `quick_win` band because the core check logic is standardized regardless of source format. |

No role fell into "automate assisted" or "keep manual" this revision either — all nine steps are within the confirmed end-to-end automation scope.

## Handoff & governance changes

Unchanged from the first pass: the only cross-team handoffs are `patch → patch_readiness_review` (platform → servicemgmt) and `patch_readiness_review → reboot_systems` (servicemgmt → platform). The four new roles (`pre_patch_validation`, `stop_application`, `start_application`, `validate_application`) are all owned by `platform`, so they don't add new cross-team wait time — see "Design choice" above for why the application team's involvement was modeled as a script-supply external dependency rather than a live per-run handoff. If the application team later needs to actively approve before their app is stopped (rather than just supplying a script once), that's a second approval node to add, not a silent assumption to bake in here.

## Estimated cost savings

```
hours_saved_per_run   = (old_process_time − new_process_time) / 60
                       = (195 − 45) / 60
                       = 2.5 hours

annual_hours_saved     = hours_saved_per_run × runs_per_year
                       = 2.5 × 24            (illustrative: twice-monthly RHEL patch cycle, unchanged assumption)
                       = 60 hours

annual_savings         = annual_hours_saved × loaded_hourly_rate
                       = 60 × $85            (illustrative: blended platform-engineer loaded rate, unchanged assumption)
                       ≈ $5,100 / year
```

Still entirely built on the illustrative estimate, not measured data — **swap in your real runs/year and loaded hourly rate.** Headcount-per-run drops from 9 to 1; treated as freed capacity, not added to the dollar figure, to avoid double-counting.

## Ansible implementation roadmap

**Phase 1 — all nine roles (all reclassified to `quick_win` under the confirmed end-to-end automation scope; no `plan`- or `defer`-band roles in this spec)**

*Pre-patching*
- `extract_repo_url_branch_commit_hash` — `ansible.builtin.git` / `ansible.builtin.uri`, unchanged from first pass.
- `fetch_patch_file` — same collection family, unchanged.
- `pre_patch_validation` **(new)** — `ansible.builtin.service_facts` for agent status ([module docs](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/service_facts_module.html)), `ansible.builtin.setup` gathered facts for filesystem size (`ansible_facts.mounts`) and kernel version (`ansible_facts.kernel`) — all ansible-core, no extra collection required. Persist the result as the `pre_patch_baseline` artifact (e.g. as workflow extra vars or an artifact file) for the final validation step to diff against.

*Patching*
- `stop_application` / `start_application` / `validate_application` **(new)** — thin wrapper tasks (`ansible.builtin.command`/`ansible.builtin.script` or a role) invoking whatever script the application team supplies via `application_lifecycle_scripts`. Until that team confirms delivery format (a git repo, a package, an ad hoc file drop), keep this as a generic `ansible.builtin.script` call rather than committing to a specific collection.
- `patch` — `ansible.builtin.dnf`, run `--check` first; unchanged reasoning. Substitute `redhat.satellite` content-view/errata modules if Satellite is confirmed in use.
- `patch_readiness_review` (approval, `servicemgmt`) — unchanged, standard [AAP approval node](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-workflow-job-templates), now gated on the check-mode diff *and* the app being confirmed stopped.
- `reboot_systems` — `ansible.builtin.reboot` ([module docs](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/reboot_module.html)), unchanged.

*Application validation*
- `validate_patches_are_applied` **(expanded)** — repeat the `service_facts`/`setup`-based checks from `pre_patch_validation`, diff against the persisted `pre_patch_baseline`, and compare against `baseline_report_source` (TechLens) once its format is confirmed — via `ansible.builtin.uri` if it turns out to be a REST API, or a scheduled CSV ingestion step if it isn't. **Do not build against a specific format yet — see Open decisions.**

*Trigger / closing the loop (external dependencies, not roles)*
- `cve_source_feed` (`integration: api`, **placeholder — unconfirmed**) — candidate sources are Red Hat Insights via the [Insights collection for Event-Driven Ansible](https://catalog.redhat.com/en/software/collection/redhat/insights_eda) (modeled on the [Insights CVE advisory EDA pattern](https://www.redhat.com/en/blog/red-hat-insights-cve-advisories)) or the TechLens portal. **Do not build the trigger integration until the org confirms which source and format (API vs. CSV) is authoritative** — building against the wrong one is wasted work either way.
- `baseline_report_source` (`integration: api`, **placeholder — unconfirmed**) — TechLens, format not finalized (API vs. CSV). No collection can be responsibly named until this is confirmed.
- `application_lifecycle_scripts` (`integration: manual`) — recommend the application team check scripts into a shared git repo/collection once delivered, upgrading this from `manual` to a `git`-sourced pull, consistent with the Lean motion-waste rubric (manual handoffs should become API/repo-based pulls wherever a real source exists).
- `change_record_update` (`integration: api`) — unchanged, `servicenow.itsm.change_request` if ServiceNow is confirmed.

**Rollout notes (unchanged):** build every playbook with `--check` first, validate with Molecule against a representative RHEL test-kit host, pilot on one host group before promoting into a shared reusable collection, then wire `workflow:` into a single AAP workflow job template with `patch_readiness_review` as the native approval node.

**Phase 2 / Phase 3:** still none — no `plan`- or `defer`-band roles exist in this spec.

## Open decisions (do not build against until confirmed)

1. **CVE source system and format.** Red Hat Insights vs. TechLens vs. another feed; API vs. CSV. Currently modeled as `cve_source_feed` with `integration: api` as a placeholder only — this is explicitly not a commitment, per the requester's instruction.
2. **Baseline-report format and source.** TechLens is a candidate for `baseline_report_source`; no public documentation exists for this tool, so the actual integration shape (REST API, CSV export, manual portal download) is unknown until the org specifies it.
3. **Satellite vs. bespoke git-sourced patch content** — carried over from the first pass, still unconfirmed.
4. **Whether the application team needs an active per-run approval** (rather than a one-time script handover) before their app is stopped — currently modeled as a passive external dependency, not a second approval node; flag if that's wrong.

## Assumptions & limitations

- **Every original role's `metrics` were placeholder defaults**, and the four new roles' metrics are illustrative estimates built for this report, not measurements. Treat every number in this report as illustrative until real timings are captured, especially for the newly-added steps which have no historical baseline at all (they weren't separately tracked before this revision).
- **`target_systems`** extended this revision to include `techlens`, inferred from the new baseline-report requirement — confirm this naming/system reference is accurate.
- **`application` was added as a new team** solely to own the `application_lifecycle_scripts` external dependency, per explicit instruction to use judgment on team/role/external-dependency modeling — it does not imply the application team executes any live step in the automated workflow (see "Design choice" above).
- **Sources consulted this revision** (new, in addition to the first-pass list already in this repo's history): [ansible.builtin.service_facts module docs](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/service_facts_module.html); a web search for "TechLens" returned no public results, confirming it should be treated as an internal/proprietary system name rather than a documented product with a known integration surface.

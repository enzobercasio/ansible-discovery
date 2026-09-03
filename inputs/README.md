# Input specs

Drop a `.spec.yml` here after exporting it from the canvas app's **Export**
tab (or hand-authoring one against the schema) when you intend to run it
through the `process-automation-advisor` agent. This is the "current state"
side of the pipeline — [`../outputs/`](../outputs) is where the agent's
to-be spec and recommendations report land, so the two never mix.

This is separate from [`../examples/`](../examples), which holds the
repo's own curated worked examples (documented in the top-level README) —
keep your own in-progress specs here instead so the two collections don't
get tangled together.

Ask the advisor agent to automate a spec here by name, e.g.:

> use the process-automation-advisor agent to automate
> `inputs/cve_patching_current_spec.yml`

or just ask it to automate "the spec in inputs/" and it'll find it.

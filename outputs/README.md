# Generated outputs

Everything under here is generated, not hand-authored — safe to delete and
regenerate. Input specs waiting to be processed belong in
[`../inputs/`](../inputs) (your own in-progress work) or
[`../examples/`](../examples) (the repo's curated worked examples); this
folder is only where downstream tools write their results, so inputs and
outputs never mix.

- **`specs/`** — the `process-automation-advisor` agent's to-be spec
  (`<process>.automated.spec.yml`) and written case
  (`<process>.automation-recommendations.md`) for every spec it's been run
  against. Re-import the `.spec.yml` into the canvas app (Import button) to
  keep refining it visually.
- **`drawio/`** — `<process>.drawio` files from `npm run drawio-export --
  <spec.yml>`. Open at <https://app.diagrams.net>, or via Miro's built-in
  diagrams.net app.
- **`miro/boards.json`** — a running log of every board `npm run miro-export
  -- <spec.yml>` has created: spec file, board id/URL, shape/connector
  counts, timestamp. There's no board file to save locally (Miro boards live
  on Miro's servers), so this is the local record of what was created and
  where.

See [`../scripts/README.md`](../scripts/README.md) for how to run the
draw.io and Miro exporters.

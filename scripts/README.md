# Exporting a workflow spec to Miro or draw.io

Both scripts read a `.spec.yml` exported from the **Export** tab and turn it
into a swimlane diagram: one lane/frame per team, one shape per
role/approval/external dependency, and connectors for every `depends_on` /
`consumed_by` relationship (dashed + labeled where a named data artifact or
an external system is involved). They share the same graph/layout logic
(`spec-graph.mjs`), so both diagrams reflect the spec identically — only the
output format differs.

| | `spec-to-miro.mjs` | `spec-to-drawio.mjs` |
|---|---|---|
| Output | A new board, created live via the Miro API, logged to `outputs/miro/boards.json` | `outputs/drawio/<process>.drawio` |
| Needs | A Miro access token | Nothing — runs offline |
| Import step | None, the board already exists | Open the file yourself |

All generated files land under [`outputs/`](../outputs) — see
[`outputs/README.md`](../outputs/README.md). Input specs in `examples/` are
never written to.

Pick draw.io if you don't want to set up a Miro API token, or if you'd
rather review the file before it lands anywhere. Pick Miro if you want the
board created for you directly.

## Option A: draw.io / diagrams.net (no token needed)

```bash
cd ansible-discovery
npm install                     # installs js-yaml if you haven't already
npm run drawio-export -- examples/rhel_host_build_spec.yml
```

This writes `outputs/drawio/rhel_host_build.drawio` (override with `--out
path/to/file.drawio`). Then either:

- Open it directly at <https://app.diagrams.net> (**File > Open From > Device**), or the desktop draw.io app, or the VS Code Draw.io Integration extension; or
- Bring it into Miro: in a Miro board, open the **Apps** panel, search for
  **"diagrams.net"**, add it, and use its **Import** button to load the
  `.drawio` file — it becomes an editable diagrams.net frame embedded in
  the board.

## Option B: Miro board via the REST API

### 1. Get a Miro access token (one-time, ~2 minutes)

1. Go to <https://miro.com/app/settings/user-profile/apps> and create a
   **Developer team** if you don't have one yet (Miro prompts for this the
   first time you try to create an app).
2. Click **Create new app**, give it a name (e.g. "Spec Importer"), pick your
   developer team, and save. Leave the default scopes as-is — `boards:write`
   is included by default and is all this script needs.
3. On the app's page, click **Install app and get OAuth token**, choose your
   team, and click **Add**. Miro displays an access token directly on screen
   — no OAuth redirect server required for this personal/single-team use.
4. Copy that token.

### 2. Run the import

```bash
cd ansible-discovery
npm install                     # installs js-yaml if you haven't already
export MIRO_ACCESS_TOKEN="paste-your-token-here"
npm run miro-export -- examples/rhel_host_build_spec.yml
```

Optional flags:

```bash
npm run miro-export -- path/to/your.spec.yml \
  --board-name "My Process"     # defaults to the spec's `process` field
  --team-id 3074457345...       # target a specific Miro team; defaults to your default team
```

The script prints the new board's URL when it finishes, and appends a record
(spec file, board id/URL, shape/connector counts, timestamp) to
`outputs/miro/boards.json`.

## Notes / limitations

- The Miro token doesn't expire unless you revoke it or delete the app —
  treat it like a password. Don't commit it; export it as an env var each
  session, or put it in a local `.env` you keep out of git.
- Layout is a left-to-right topological ordering of the dependency graph,
  one row per team — it won't exactly match the hand-arranged canvas layout,
  but every node, team grouping, and dependency/handoff is preserved.
- Steps whose `owner_team` isn't in the spec's `teams` list are skipped
  (logged nowhere currently — check shape counts if something looks missing).
- Re-running `miro-export` always creates a **new** board; it doesn't update
  an existing one (though it does keep appending to `boards.json`).
  `drawio-export` overwrites its output file each run.

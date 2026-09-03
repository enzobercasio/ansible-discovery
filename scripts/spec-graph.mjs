// Shared spec-parsing and layout logic for the Miro and draw.io exporters.
// Turns an Automation Discovery Canvas workflow spec (.spec.yml) into a
// left-to-right layered dependency graph, one row per team.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// All generated exporter output lives under outputs/<kind>/, standardized so
// spec-to-drawio.mjs and spec-to-miro.mjs never scatter files into whatever
// directory they happened to be run from. Ensures the directory exists.
export function outputPath(kind, filename) {
  const dir = join(PROJECT_ROOT, "outputs", kind);
  mkdirSync(dir, { recursive: true });
  return join(dir, filename);
}

export const COL_W = 340;
export const SHAPE_W = 300;
export const SHAPE_H = 110;
export const PAD = 60;

export const BAND_COLOR = { quick_win: "#8fd14f", plan: "#f5d76e", defer: "#d5d9e0" };
export const APPROVAL_COLOR = "#a6ccf5";
export const EXTERNAL_COLOR = "#f16c7f";

export function teamLabel(id) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function teamsOf(spec) {
  return spec.teams && spec.teams.length ? spec.teams : [...new Set((spec.roles || []).map((r) => r.owner_team))];
}

export function buildGraph(spec) {
  const nodes = new Map(); // name -> { name, label, team, kind, band, automated, metrics, integration }
  const deps = new Map(); // name -> [dep names]

  for (const r of spec.roles || []) {
    nodes.set(r.name, {
      name: r.name,
      label: r.label || r.name,
      team: r.owner_team,
      kind: "role",
      band: r.band,
      automated: !!r.automated,
      metrics: r.metrics || {},
    });
    deps.set(r.name, r.depends_on || []);
  }
  for (const a of spec.approvals || []) {
    nodes.set(a.name, { name: a.name, label: a.label || a.name, team: a.owner_team, kind: "approval" });
    deps.set(a.name, a.depends_on || []);
  }
  for (const e of spec.external_dependencies || []) {
    nodes.set(e.name, {
      name: e.name,
      label: e.label || e.name,
      team: e.owner_team,
      kind: "external",
      integration: e.integration,
    });
    deps.set(e.name, []); // external deps are sources; edges come from consumed_by
    for (const consumer of e.consumed_by || []) {
      const cur = deps.get(consumer) || [];
      if (!cur.includes(e.name)) cur.push(e.name);
      deps.set(consumer, cur);
    }
  }

  // longest-path layering (Kahn's algorithm variant) for left-to-right columns
  const column = new Map();
  const visiting = new Set();
  function colOf(name) {
    if (column.has(name)) return column.get(name);
    if (visiting.has(name)) return 0; // guard against bad cyclic data
    visiting.add(name);
    const ds = deps.get(name) || [];
    const c = ds.length ? 1 + Math.max(...ds.map((d) => (nodes.has(d) ? colOf(d) : 0))) : 0;
    visiting.delete(name);
    column.set(name, c);
    return c;
  }
  for (const name of nodes.keys()) colOf(name);

  // extra caption info for edges carrying a named data artifact
  const artifactByPair = new Map();
  for (const h of spec.handoffs || []) {
    if (h.type === "data" && h.artifact) artifactByPair.set(`${h.from}->${h.to}`, h.artifact);
  }

  const edges = [];
  for (const [name, ds] of deps.entries()) {
    for (const d of ds) {
      if (!nodes.has(d) || !nodes.has(name)) continue;
      const artifact = artifactByPair.get(`${d}->${name}`);
      const isExternal = nodes.get(d).kind === "external";
      edges.push({ from: d, to: name, artifact, dashed: isExternal || !!artifact });
    }
  }

  return { nodes, column, edges };
}

// Groups nodes into per-team rows and computes each row's height and each
// node's position (frame/lane-relative, top-left origin) — shared between
// exporters that both use a "one container per team, stacked vertically" layout.
export function layoutRows(teams, nodes, column) {
  const rowsByTeamCol = new Map(); // `${team}:${col}` -> count seen so far (stacking collisions)
  const rows = [];
  let yCursor = 0;

  for (const team of teams) {
    const nodesInTeam = [...nodes.values()].filter((n) => n.team === team);
    const countByCol = nodesInTeam.reduce((acc, n) => {
      const c = column.get(n.name);
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {});
    const maxStack = Math.max(1, ...Object.values(countByCol));
    const height = PAD * 2 + maxStack * (SHAPE_H + 24) - 24 + 30; // +30 for title bar

    const positions = [];
    for (const node of nodesInTeam) {
      const key = `${team}:${column.get(node.name)}`;
      const stackIndex = rowsByTeamCol.get(key) || 0;
      rowsByTeamCol.set(key, stackIndex + 1);
      positions.push({
        node,
        x: PAD + column.get(node.name) * COL_W,
        y: PAD + 30 + stackIndex * (SHAPE_H + 24),
      });
    }

    rows.push({ team, height, y: yCursor, positions });
    yCursor += height + 40;
  }

  return { rows, totalHeight: yCursor };
}

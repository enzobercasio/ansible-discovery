#!/usr/bin/env node
// Import an Automation Discovery Canvas workflow spec (.spec.yml) into a new Miro board.
//
// Usage:
//   MIRO_ACCESS_TOKEN=xxxx node scripts/spec-to-miro.mjs <spec.yml> [--team-id <id>] [--board-name "Name"]
//
// Requires:
//   npm install js-yaml   (run once inside ansible-discovery/)
//   A Miro access token with the boards:write scope. See scripts/README.md.
//
// Every run appends a record (spec, process, board id/url, timestamp) to
// outputs/miro/boards.json — there's no board file to save locally, so this
// manifest is the local record of what was created and where.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";
import {
  buildGraph,
  teamsOf,
  teamLabel,
  layoutRows,
  outputPath,
  BAND_COLOR,
  APPROVAL_COLOR,
  EXTERNAL_COLOR,
  COL_W,
  SHAPE_W,
  SHAPE_H,
  PAD,
} from "./spec-graph.mjs";

const API = "https://api.miro.com/v2";
const TOKEN = process.env.MIRO_ACCESS_TOKEN;

function parseArgs(argv) {
  const args = { file: null, teamId: process.env.MIRO_TEAM_ID || null, boardName: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--team-id") args.teamId = argv[++i];
    else if (a === "--board-name") args.boardName = argv[++i];
    else if (!args.file) args.file = a;
  }
  return args;
}

async function miro(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Miro API ${opts.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  if (!TOKEN) {
    console.error("Set MIRO_ACCESS_TOKEN in your environment first. See scripts/README.md.");
    process.exit(1);
  }
  const { file, teamId, boardName } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error("Usage: MIRO_ACCESS_TOKEN=xxx node scripts/spec-to-miro.mjs <spec.yml> [--team-id <id>] [--board-name Name]");
    process.exit(1);
  }

  const spec = yaml.load(readFileSync(file, "utf8"));
  const teams = teamsOf(spec);
  const { nodes, column, edges } = buildGraph(spec);
  const { rows } = layoutRows(teams, nodes, column);

  const maxColumn = Math.max(0, ...[...column.values()]);
  const boardWidth = PAD * 2 + (maxColumn + 1) * COL_W;

  console.log(`Creating board for "${spec.process}" (${nodes.size} nodes, ${edges.length} edges, ${teams.length} swimlanes)...`);
  const board = await miro("/boards", {
    method: "POST",
    body: JSON.stringify({
      name: boardName || spec.process || "Workflow",
      ...(teamId ? { teamId } : {}),
    }),
  });
  console.log(`Board created: ${board.viewLink}`);

  // one frame per team, stacked top to bottom in team order
  const frameByTeam = new Map();
  for (const row of rows) {
    const frame = await miro(`/boards/${board.id}/frames`, {
      method: "POST",
      body: JSON.stringify({
        data: { title: teamLabel(row.team), type: "freeform", format: "custom" },
        position: { x: boardWidth / 2, y: row.y + row.height / 2 },
        geometry: { width: boardWidth, height: row.height },
      }),
    });
    frameByTeam.set(row.team, frame.id);
  }

  // shapes, positioned frame-relative (top-left origin within the frame)
  const itemIdByName = new Map();
  for (const row of rows) {
    const frameId = frameByTeam.get(row.team);
    for (const { node, x, y } of row.positions) {
      const shape = node.kind === "approval" ? "rhombus" : node.kind === "external" ? "cloud" : "rectangle";
      const fillColor = node.kind === "approval" ? APPROVAL_COLOR : node.kind === "external" ? EXTERNAL_COLOR : BAND_COLOR[node.band] || "#e6e9ef";
      const metaLine =
        node.kind === "role" && node.metrics
          ? `<p>${node.automated ? "Automated" : "Manual"} · ${node.metrics.process_time ?? "?"}m / ${node.metrics.lead_time ?? "?"}m</p>`
          : node.kind === "external"
          ? `<p>${node.integration || "external"}</p>`
          : "";

      const item = await miro(`/boards/${board.id}/shapes`, {
        method: "POST",
        body: JSON.stringify({
          data: { content: `<p><strong>${node.label}</strong></p>${metaLine}`, shape },
          position: { x: x + SHAPE_W / 2, y: y + SHAPE_H / 2 },
          geometry: { width: SHAPE_W, height: SHAPE_H },
          style: { fillColor, fontSize: "12" },
          parent: { id: frameId },
        }),
      });
      itemIdByName.set(node.name, item.id);
    }
  }

  // connectors
  for (const edge of edges) {
    const startId = itemIdByName.get(edge.from);
    const endId = itemIdByName.get(edge.to);
    if (!startId || !endId) continue;
    await miro(`/boards/${board.id}/connectors`, {
      method: "POST",
      body: JSON.stringify({
        startItem: { id: startId },
        endItem: { id: endId },
        shape: "elbowed",
        ...(edge.artifact ? { captions: [{ content: `<p>${edge.artifact}</p>` }] } : {}),
        style: {
          strokeStyle: edge.dashed ? "dashed" : "normal",
          strokeColor: edge.dashed ? "#f16c7f" : "#1a1a1a",
          endStrokeCap: "arrow",
        },
      }),
    });
  }

  console.log(`Done. ${itemIdByName.size} shapes, ${edges.length} connectors.`);
  console.log(board.viewLink);

  const manifestPath = outputPath("miro", "boards.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
  manifest.push({
    spec: file,
    process: spec.process || null,
    boardId: board.id,
    viewLink: board.viewLink,
    shapes: itemIdByName.size,
    connectors: edges.length,
    createdAt: new Date().toISOString(),
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Logged to ${manifestPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

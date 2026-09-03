#!/usr/bin/env node
// Convert an Automation Discovery Canvas workflow spec (.spec.yml) into a
// draw.io / diagrams.net file: one swimlane per team, one shape per
// role/approval/external dependency, connectors for every dependency and
// handoff. No API token needed — open the .drawio file directly in
// draw.io/diagrams.net, or drop it onto a Miro board via Miro's built-in
// diagrams.net app.
//
// Usage:
//   node scripts/spec-to-drawio.mjs <spec.yml> [--out path/to/file.drawio]
//
// Writes to outputs/drawio/<process>.drawio by default (created if missing);
// pass --out to write somewhere else instead.
//
// Requires:
//   npm install js-yaml   (run once inside ansible-discovery/)

import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import yaml from "js-yaml";
import { buildGraph, teamsOf, teamLabel, layoutRows, outputPath, BAND_COLOR, APPROVAL_COLOR, EXTERNAL_COLOR, COL_W, SHAPE_W, SHAPE_H, PAD } from "./spec-graph.mjs";

function parseArgs(argv) {
  const args = { file: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (!args.file) args.file = a;
  }
  return args;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function main() {
  const { file, out } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error("Usage: node scripts/spec-to-drawio.mjs <spec.yml> [--out path/to/file.drawio]");
    process.exit(1);
  }

  const spec = yaml.load(readFileSync(file, "utf8"));
  const teams = teamsOf(spec);
  const { nodes, column, edges } = buildGraph(spec);
  const { rows, totalHeight } = layoutRows(teams, nodes, column);

  const maxColumn = Math.max(0, ...[...column.values()]);
  const laneWidth = PAD * 2 + (maxColumn + 1) * COL_W;

  let nextId = 2; // 0 and 1 are the mxGraph root cells
  const id = () => `n${nextId++}`;
  const cells = [];
  const idByName = new Map();

  for (const row of rows) {
    const laneId = id();
    cells.push(
      `<mxCell id="${laneId}" value="${esc(teamLabel(row.team))}" style="swimlane;horizontal=0;whiteSpace=wrap;html=1;startSize=30;fillColor=#ffffff;" vertex="1" parent="1">` +
        `<mxGeometry x="0" y="${row.y}" width="${laneWidth}" height="${row.height}" as="geometry" /></mxCell>`
    );

    for (const { node, x, y } of row.positions) {
      const shapeId = id();
      idByName.set(node.name, shapeId);

      const style =
        node.kind === "approval"
          ? `rhombus;whiteSpace=wrap;html=1;fillColor=${APPROVAL_COLOR};`
          : node.kind === "external"
          ? `shape=cloud;whiteSpace=wrap;html=1;fillColor=${EXTERNAL_COLOR};`
          : `rounded=1;whiteSpace=wrap;html=1;fillColor=${BAND_COLOR[node.band] || "#e6e9ef"};`;

      const metaLine =
        node.kind === "role" && node.metrics
          ? `&lt;br&gt;&lt;font style=&quot;font-size:11px&quot;&gt;${esc(node.automated ? "Automated" : "Manual")} · ${node.metrics.process_time ?? "?"}m / ${node.metrics.lead_time ?? "?"}m&lt;/font&gt;`
          : node.kind === "external"
          ? `&lt;br&gt;&lt;font style=&quot;font-size:11px&quot;&gt;${esc(node.integration || "external")}&lt;/font&gt;`
          : "";

      cells.push(
        `<mxCell id="${shapeId}" value="${esc(node.label)}${metaLine}" style="${style}" vertex="1" parent="${laneId}">` +
          `<mxGeometry x="${x}" y="${y}" width="${SHAPE_W}" height="${SHAPE_H}" as="geometry" /></mxCell>`
      );
    }
  }

  for (const edge of edges) {
    const sourceId = idByName.get(edge.from);
    const targetId = idByName.get(edge.to);
    if (!sourceId || !targetId) continue;
    const edgeId = id();
    const style = edge.dashed
      ? "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;dashed=1;strokeColor=#f16c7f;"
      : "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#1a1a1a;";
    cells.push(
      `<mxCell id="${edgeId}" value="${edge.artifact ? esc(edge.artifact) : ""}" style="${style}" edge="1" parent="1" source="${sourceId}" target="${targetId}">` +
        `<mxGeometry relative="1" as="geometry" /></mxCell>`
    );
  }

  const xml =
    `<mxfile host="app.diagrams.net">` +
    `<diagram name="${esc(spec.process || "Workflow")}">` +
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${laneWidth}" pageHeight="${totalHeight}" math="0" shadow="0">` +
    `<root><mxCell id="0" /><mxCell id="1" parent="0" />` +
    cells.join("") +
    `</root></mxGraphModel></diagram></mxfile>`;

  const slug = basename(file, extname(file)).replace(/(\.automated)?(\.spec)?$/, "");
  const outPath = out || outputPath("drawio", `${slug}.drawio`);
  writeFileSync(outPath, xml, "utf8");
  console.log(`Wrote ${outPath} (${idByName.size} shapes, ${edges.length} connectors, ${rows.length} swimlanes).`);
  console.log("Open it at https://app.diagrams.net (File > Open From > Device), or in Miro via the diagrams.net app (search 'diagrams.net' in Miro's Apps panel, then Import).");
}

main();

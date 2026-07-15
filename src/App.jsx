import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Plus, GitBranch, Play, Square, Trash2, Copy, Download, Check, Info,
  RotateCcw, ListOrdered, FileCode, Gauge, Server, ArrowRight,
  ShieldCheck, ExternalLink, Users, ArrowLeftRight, Eraser, FileDown, Repeat, Upload, Timer,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Tokens + layout constants                                          */
/* ------------------------------------------------------------------ */
const T = {
  ink: "#0F172A", sub: "#475569", faint: "#94A3B8", line: "#E2E8F0",
  canvas: "#F1F5F9", grid: "#E4E9F0", accent: "#C81E1E", accentSoft: "#FCE9E9",
  data: "#2563EB", external: "#EA580C", quick: "#0D9488", plan: "#D97706", defer: "#64748B",
};
const NODE_W = 210, NODE_H = 84, LANE_H = 168, WORLD_W = 1320, PAD = 16;
const TEAM_PALETTE = ["#2563EB", "#0D9488", "#C81E1E", "#D97706", "#7C3AED", "#DB2777", "#0891B2", "#65A30D"];

const NODE_META = {
  task:     { color: "#C81E1E", icon: Server,       kind: "Role" },
  approval: { color: "#7C3AED", icon: ShieldCheck,  kind: "Approval gate" },
  gateway:  { color: "#64748B", icon: GitBranch,    kind: "Decision" },
  external: { color: "#EA580C", icon: ExternalLink, kind: "External" },
  start:    { color: "#059669", icon: Play,         kind: "Trigger" },
  end:      { color: "#475569", icon: Square,       kind: "Terminus" },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const slug = (s) => (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unnamed";
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const splitList = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);

const isReusable = (n) => !!(n.reuseClaim && n.reuseParam && n.reuseOwner);   // verified, not just claimed
function scoreOf(n) {
  const s = n.scores || {};
  const f = s.frequency ?? 3, st = s.standardisation ?? 3, e = s.errorProneness ?? 3, c = s.complexity ?? 3;
  const base = Math.round((0.3 * f + 0.3 * st + 0.25 * e + 0.15 * (6 - c)) * 2 * 10) / 10;
  return isReusable(n) ? Math.max(base, 7.5) : base;   // verified reusable -> promoted to quick win
}
function bandOf(score) {
  if (score >= 7.5) return { key: "quick_win", label: "Quick win", color: T.quick };
  if (score >= 5) return { key: "plan", label: "Plan", color: T.plan };
  return { key: "defer", label: "Defer", color: T.defer };
}
/* Metrics-Based Process Mapping (MBPM) — per-step baseline metrics */
const metricsOf = (n) => {
  const m = n.metrics || {};
  return { resources: m.resources ?? 1, processTime: m.processTime ?? 0, leadTime: m.leadTime ?? 0, pctCA: m.pctCA ?? 100 };
};
function mbpmSummary(tasks) {
  let pt = 0, lt = 0, res = 0, rolled = 1, n = 0;
  tasks.forEach((t) => { const m = metricsOf(t); pt += m.processTime; lt += m.leadTime; res += m.resources; rolled *= m.pctCA / 100; n++; });
  return {
    count: n, totalPT: Math.round(pt), totalLT: Math.round(lt), resources: res,
    activityRatio: lt > 0 ? Math.round((pt / lt) * 1000) / 10 : null,   // % of lead time spent working
    rolledCA: n ? Math.round(rolled * 1000) / 10 : null,                 // compounded first-pass quality
  };
}
const ratioColor = (r) => (r == null ? T.faint : r < 25 ? T.accent : r < 50 ? T.plan : T.quick);
const caColor = (c) => (c == null ? T.faint : c < 80 ? T.accent : c < 95 ? T.plan : T.quick);
const laneIndex = (teams, teamId) => Math.max(0, teams.findIndex((t) => t.id === teamId));
const clampToLane = (y, idx) =>
  Math.min((idx + 1) * LANE_H - NODE_H - PAD, Math.max(idx * LANE_H + PAD + 22, y));

/* ------------------------------------------------------------------ */
/*  Spec builder — the AAP-shaped output                               */
/* ------------------------------------------------------------------ */
function buildSpec(processName, nodes, edges, teams) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const wfType = (t) => t === "task" || t === "approval";

  const predsOf = (id) => {
    const res = new Set();
    const walk = (cur, seen) => {
      edges.filter((e) => e.target === cur).forEach((e) => {
        const s = byId[e.source]; if (!s || s.type === "external") return;
        if (wfType(s.type)) res.add(slug(s.label));
        else if ((s.type === "gateway" || s.type === "start") && !seen.has(s.id)) { seen.add(s.id); walk(s.id, seen); }
      });
    };
    walk(id, new Set([id]));
    return [...res];
  };
  const consumesOf = (id) =>
    edges.filter((e) => e.target === id && e.type === "data")
      .map((e) => { const s = byId[e.source]; if (!s || s.type === "external") return null; return { from: slug(s.label), artifact: e.artifact || "output" }; })
      .filter(Boolean);
  const isHandoff = (node) =>
    edges.some((e) => { if (e.target !== node.id) return false; const s = byId[e.source]; return s && wfType(s.type) && s.team !== node.team; });

  const tasks = nodes.filter((n) => n.type === "task");
  const roles = tasks.map((t) => {
    const sc = scoreOf(t), s = t.scores || {}, mm = metricsOf(t);
    return {
      name: slug(t.label), label: t.label, owner_team: t.team,
      priority_score: sc, band: bandOf(sc).key, reusable: isReusable(t),
      suitability: { frequency: s.frequency ?? 3, standardisation: s.standardisation ?? 3, error_proneness: s.errorProneness ?? 3, complexity: s.complexity ?? 3 },
      metrics: { resources: mm.resources, process_time: mm.processTime, lead_time: mm.leadTime, pct_complete_accurate: mm.pctCA },
      target_systems: (t.systems || []).slice().sort(), inputs: (t.inputs || []).slice(),
      depends_on: predsOf(t.id), consumes: consumesOf(t.id), handoff: isHandoff(t),
    };
  }).sort((a, b) => b.priority_score - a.priority_score);
  const baseline = mbpmSummary(tasks);

  const approvals = nodes.filter((n) => n.type === "approval")
    .map((n) => ({ name: slug(n.label), owner_team: n.team, depends_on: predsOf(n.id) }));

  const external_dependencies = nodes.filter((n) => n.type === "external").map((n) => {
    const nb = new Set();
    edges.forEach((e) => {
      if (e.source === n.id) { const t = byId[e.target]; if (t && wfType(t.type)) nb.add(slug(t.label)); }
      if (e.target === n.id) { const s = byId[e.source]; if (s && wfType(s.type)) nb.add(slug(s.label)); }
    });
    return { name: slug(n.label), owner_team: n.team, integration: n.integration || "manual", consumed_by: [...nb] };
  });

  const handoffs = edges.filter((e) => {
    const s = byId[e.source], t = byId[e.target];
    return s && t && wfType(s.type) && wfType(t.type) && s.team !== t.team;
  }).map((e) => {
    const s = byId[e.source], t = byId[e.target];
    return { from: slug(s.label), from_team: s.team, to: slug(t.label), to_team: t.team,
      type: e.type || "sequence", artifact: e.type === "data" ? (e.artifact || "output") : undefined };
  });

  // workflow order (topological, ties broken left-to-right)
  const wf = nodes.filter((n) => wfType(n.type));
  const wfIds = new Set(wf.map((n) => n.id));
  const succ = {}; wf.forEach((n) => (succ[n.id] = new Set()));
  wf.forEach((n) => {
    const walk = (cur, seen) => edges.filter((e) => e.source === cur).forEach((e) => {
      const t = byId[e.target]; if (!t || t.type === "external" || t.type === "end") return;
      if (wfIds.has(t.id)) succ[n.id].add(t.id);
      else if ((t.type === "gateway" || t.type === "start") && !seen.has(t.id)) { seen.add(t.id); walk(t.id, seen); }
    });
    walk(n.id, new Set([n.id]));
  });
  const indeg = {}; wf.forEach((n) => (indeg[n.id] = 0));
  wf.forEach((n) => succ[n.id].forEach((s) => indeg[s]++));
  const xOf = (id) => byId[id].x;
  let q = wf.filter((n) => indeg[n.id] === 0).map((n) => n.id).sort((a, b) => xOf(a) - xOf(b));
  const order = [], used = new Set();
  while (q.length) {
    const id = q.shift(); if (used.has(id)) continue; used.add(id); order.push(id);
    succ[id].forEach((s) => indeg[s]--);
    const ready = wf.filter((n) => !used.has(n.id) && indeg[n.id] === 0 && !q.includes(n.id)).map((n) => n.id).sort((a, b) => xOf(a) - xOf(b));
    q = q.concat(ready);
  }
  wf.forEach((n) => { if (!used.has(n.id)) order.push(n.id); });
  const workflow = order.map((id) => { const n = byId[id]; return n.type === "approval" ? { approval: slug(n.label) } : slug(n.label); });

  return {
    process: slug(processName), teams: teams.map((t) => t.id),
    target_systems: [...new Set(tasks.flatMap((t) => t.systems || []))].sort(),
    baseline,
    roles, approvals, external_dependencies, handoffs, workflow,
  };
}

function toYaml(spec) {
  const A = (a) => (a && a.length ? `[${a.join(", ")}]` : "[]");
  let o = "";
  o += `process: ${spec.process}\n`;
  o += `generated_by: ansible-automation-discovery-canvas\n`;
  o += `teams: ${A(spec.teams)}\n`;
  o += `target_systems: ${A(spec.target_systems)}\n`;
  if (spec.baseline) {
    const b = spec.baseline;
    o += `baseline:            # metrics-based process mapping (current state)\n`;
    o += `  total_process_time: ${b.totalPT}\n  total_lead_time: ${b.totalLT}\n`;
    o += `  activity_ratio_pct: ${b.activityRatio == null ? "null" : b.activityRatio}\n`;
    o += `  rolled_complete_accurate_pct: ${b.rolledCA == null ? "null" : b.rolledCA}\n`;
    o += `  total_resources: ${b.resources}\n`;
  }
  o += `roles:\n`;
  if (!spec.roles.length) o += "  []\n";
  spec.roles.forEach((r) => {
    o += `  - name: ${r.name}\n    label: ${JSON.stringify(r.label)}\n    owner_team: ${r.owner_team}\n`;
    o += `    priority_score: ${r.priority_score}\n    band: ${r.band}\n    reusable: ${r.reusable}\n`;
    o += `    suitability: { frequency: ${r.suitability.frequency}, standardisation: ${r.suitability.standardisation}, error_proneness: ${r.suitability.error_proneness}, complexity: ${r.suitability.complexity} }\n`;
    o += `    metrics: { resources: ${r.metrics.resources}, process_time: ${r.metrics.process_time}, lead_time: ${r.metrics.lead_time}, pct_complete_accurate: ${r.metrics.pct_complete_accurate} }\n`;
    o += `    target_systems: ${A(r.target_systems)}\n    inputs: ${A(r.inputs)}\n`;
    o += `    depends_on: ${A(r.depends_on)}\n    handoff: ${r.handoff}\n`;
    if (r.consumes.length) { o += `    consumes:\n`; r.consumes.forEach((c) => (o += `      - from: ${c.from}\n        artifact: ${c.artifact}\n`)); }
  });
  if (spec.approvals.length) { o += `approvals:\n`; spec.approvals.forEach((a) => (o += `  - name: ${a.name}\n    owner_team: ${a.owner_team}\n    depends_on: ${A(a.depends_on)}\n`)); }
  if (spec.external_dependencies.length) {
    o += `external_dependencies:\n`;
    spec.external_dependencies.forEach((e) => (o += `  - name: ${e.name}\n    owner_team: ${e.owner_team}\n    integration: ${e.integration}\n    consumed_by: ${A(e.consumed_by)}\n`));
  }
  if (spec.handoffs.length) {
    o += `handoffs:\n`;
    spec.handoffs.forEach((h) => { o += `  - from: ${h.from}\n    from_team: ${h.from_team}\n    to: ${h.to}\n    to_team: ${h.to_team}\n    type: ${h.type}\n`; if (h.artifact) o += `    artifact: ${h.artifact}\n`; });
  }
  o += `workflow:            # -> AAP workflow job template\n`;
  if (!spec.workflow.length) o += "  []\n";
  spec.workflow.forEach((w) => (o += typeof w === "string" ? `  - ${w}\n` : `  - { approval: ${w.approval} }\n`));
  return o;
}

/* ------------------------------------------------------------------ */
/*  Export: render the whole diagram to a standalone SVG              */
/*  (independent of scroll / live DOM, so it always captures it all)  */
/* ------------------------------------------------------------------ */
const xesc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function buildExportSVG(processName, nodes, edges, teams, worldH) {
  const TITLE_H = 60, W = WORLD_W;
  const H = TITLE_H + worldH;
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const gOut = (n) => ({ x: n.x + NODE_W, y: n.y + NODE_H / 2 });
  const gIn = (n) => ({ x: n.x, y: n.y + NODE_H / 2 });
  const gPath = (a, b) => { const off = Math.max(60, Math.abs(b.x - a.x) * 0.4); return `M ${a.x} ${a.y} C ${a.x + off} ${a.y}, ${b.x - off} ${b.y}, ${b.x} ${b.y}`; };

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
  // title band
  s += `<text x="24" y="28" font-size="16" font-weight="700" fill="${T.ink}">${xesc(processName)}</text>`;
  s += `<text x="24" y="46" font-size="11.5" fill="${T.sub}">Automation Discovery Canvas &#183; ${nodes.filter((n) => n.type === "task").length} roles &#183; ${teams.length} teams</text>`;
  // legend
  const lg = [["#94A3B8", "0", "sequence"], [T.data, "7 5", "data"], [T.external, "2 5", "external"]];
  let lx = W - 300;
  lg.forEach(([c, d, lab]) => { s += `<line x1="${lx}" y1="34" x2="${lx + 26}" y2="34" stroke="${c}" stroke-width="2" stroke-dasharray="${d}"/><text x="${lx + 32}" y="38" font-size="11" fill="${T.sub}">${lab}</text>`; lx += 90; });
  // markers
  s += `<defs>`;
  [["ar", "#94A3B8"], ["ad", T.data], ["ae", T.external]].forEach(([id, c]) => {
    s += `<marker id="${id}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,3 L0,6 Z" fill="${c}"/></marker>`;
  });
  s += `</defs><g transform="translate(0,${TITLE_H})">`;

  // lanes
  teams.forEach((t, i) => {
    const y = i * LANE_H;
    s += `<rect x="0" y="${y}" width="${W}" height="${LANE_H}" fill="${t.color}14"/>`;
    s += `<line x1="0" y1="${y + LANE_H}" x2="${W}" y2="${y + LANE_H}" stroke="${T.line}"/>`;
    const w = 24 + (t.name.length * 7);
    s += `<rect x="12" y="${y + 10}" width="${w}" height="22" rx="11" fill="#fff" stroke="${t.color}"/>`;
    s += `<circle cx="26" cy="${y + 21}" r="4" fill="${t.color}"/>`;
    s += `<text x="36" y="${y + 25}" font-size="11.5" font-weight="650" fill="${t.color}">${xesc(t.name)}</text>`;
  });

  // edges
  edges.forEach((e) => {
    const sN = byId[e.source], tN = byId[e.target]; if (!sN || !tN) return;
    const a = gOut(sN), b = gIn(tN), d = gPath(a, b);
    const isExt = sN.type === "external" || tN.type === "external";
    const isData = e.type === "data";
    const cross = (sN.type === "task" || sN.type === "approval") && (tN.type === "task" || tN.type === "approval") && sN.team !== tN.team;
    const stroke = isExt ? T.external : isData ? T.data : (cross ? T.ink : "#94A3B8");
    const dash = isExt ? "2 5" : isData ? "7 5" : "0";
    const mk = isExt ? "ae" : isData ? "ad" : "ar";
    s += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${cross || isData || isExt ? 2 : 1.6}" stroke-dasharray="${dash}" marker-end="url(#${mk})"/>`;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (isData && e.artifact) {
      s += `<rect x="${mid.x - 52}" y="${mid.y - 11}" width="104" height="22" rx="6" fill="#fff" stroke="${T.data}"/><text x="${mid.x}" y="${mid.y + 4}" text-anchor="middle" font-size="10.5" font-family="ui-monospace,monospace" fill="${T.data}">${xesc(truncate(e.artifact, 15))}</text>`;
    } else if (cross && !isExt) {
      s += `<circle cx="${mid.x}" cy="${mid.y}" r="5" fill="${teamById[sN.team]?.color || T.accent}" stroke="#fff" stroke-width="1.5"/>`;
    }
  });

  // nodes
  nodes.forEach((n) => {
    const M = NODE_META[n.type], isTask = n.type === "task";
    const fill = n.type === "external" ? "#FFF7ED" : "#ffffff";
    s += `<g transform="translate(${n.x},${n.y})">`;
    s += `<rect x="0" y="0" width="${NODE_W}" height="${NODE_H}" rx="11" fill="${fill}" stroke="${T.line}"${n.type === "external" ? ' stroke-dasharray="4 3"' : ""}/>`;
    s += `<path d="M0 11 a11 11 0 0 1 11 -11 v${NODE_H} h-6 a5 5 0 0 1 -5 -5 Z" fill="${M.color}"/>`;
    s += `<rect x="5" y="1" width="4" height="${NODE_H - 2}" fill="${M.color}"/>`;
    s += `<text x="15" y="19" font-size="10" font-weight="700" fill="${M.color}" letter-spacing="0.5">${M.kind.toUpperCase()}</text>`;
    if (isTask) {
      const sc = scoreOf(n), band = bandOf(sc);
      s += `<rect x="${NODE_W - 42}" y="8" width="34" height="18" rx="9" fill="${band.color}"/><text x="${NODE_W - 25}" y="21" text-anchor="middle" font-size="11" font-weight="700" font-family="ui-monospace,monospace" fill="#fff">${sc}</text>`;
      if (isReusable(n)) s += `<rect x="${NODE_W - 108}" y="8" width="62" height="18" rx="9" fill="#fff" stroke="${T.quick}"/><text x="${NODE_W - 77}" y="21" text-anchor="middle" font-size="9.5" font-weight="700" fill="${T.quick}">REUSABLE</text>`;
    }
    s += `<text x="15" y="42" font-size="13.5" font-weight="650" fill="${T.ink}">${xesc(truncate(n.label || "untitled", 24))}</text>`;
    const sub = isTask ? slug(n.label) : n.type === "external" ? (n.integration || "manual") : n.type === "gateway" ? `routes ${edges.filter((e) => e.source === n.id).length} branch(es)` : "";
    if (sub) s += `<text x="15" y="60" font-size="11" font-family="ui-monospace,monospace" fill="${n.type === "external" ? T.external : T.sub}">${xesc(truncate(sub, 26))}</text>`;
    s += `</g>`;
  });

  s += `</g></svg>`;
  return { svg: s, width: W, height: H };
}

/* Dependency-free single-page PDF that embeds a JPEG (ASCIIHex + DCT). */
/* Fully ASCII output, so string length == byte length and xref is exact. */
function jpegDataUrlToPdf(dataUrl, imgW, imgH) {
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  let hex = "";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  const stream = hex + ">";
  const PW = 842, PH = 595, m = 24;                       // A4 landscape, pt
  const sc = Math.min((PW - m * 2) / imgW, (PH - m * 2) / imgH);
  const dw = imgW * sc, dh = imgH * sc, dx = (PW - dw) / 2, dy = (PH - dh) / 2;
  const f = (x) => x.toFixed(2);
  const content = `q ${f(dw)} 0 0 ${f(dh)} ${f(dx)} ${f(dy)} cm /Im0 Do Q`;

  const objs = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [ /ASCIIHexDecode /DCTDecode ] /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  const header = "%PDF-1.3\n";
  const offsets = []; let pos = header.length;
  objs.forEach((o) => { offsets.push(pos); pos += o.length; });
  const xrefStart = pos;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { xref += `${String(off).padStart(10, "0")} 00000 n \n`; });
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return header + objs.join("") + xref + trailer;
}

/* ------------------------------------------------------------------ */
/*  Import: parse a spec (YAML) and rebuild the canvas graph          */
/* ------------------------------------------------------------------ */
function parseScalar(s) {
  s = s.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s[0] === "[") {
    const inner = s.slice(1, s.lastIndexOf("]"));
    return inner.trim() === "" ? [] : inner.split(",").map((x) => parseScalar(x));
  }
  if (s[0] === "{") {
    const inner = s.slice(1, s.lastIndexOf("}")), obj = {};
    if (inner.trim() !== "") inner.split(",").forEach((pair) => { const i = pair.indexOf(":"); if (i >= 0) obj[pair.slice(0, i).trim()] = parseScalar(pair.slice(i + 1)); });
    return obj;
  }
  if (s[0] === '"') { try { return JSON.parse(s); } catch { return s.replace(/^"|"$/g, ""); } }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
function parseYaml(text) {
  const lines = [];
  String(text).replace(/\r\n/g, "\n").split("\n").forEach((ln) => {
    const t = ln.trim();
    if (t === "" || t.startsWith("#")) return;
    let content = ln;
    if (!content.includes('"')) { const h = content.indexOf(" #"); if (h >= 0) content = content.slice(0, h); }
    if (content.trim() === "") return;
    lines.push({ indent: content.length - content.trimStart().length, content: content.trim() });
  });
  let i = 0;
  const peek = () => (i < lines.length ? lines[i] : null);
  function parseBlock(indent) {
    const p = peek();
    if (!p || p.indent < indent) return null;
    return p.content.startsWith("- ") ? parseSeq(indent) : parseMap(indent);
  }
  function parseMap(indent) {
    const obj = {};
    while (true) {
      const p = peek();
      if (!p || p.indent !== indent || p.content.startsWith("- ")) break;
      const ci = p.content.indexOf(":");
      if (ci < 0) { i++; continue; }
      const key = p.content.slice(0, ci).trim(), valStr = p.content.slice(ci + 1).trim();
      i++;
      if (valStr === "") { const nx = peek(); obj[key] = nx && nx.indent > indent ? parseBlock(nx.indent) : null; }
      else obj[key] = parseScalar(valStr);
    }
    return obj;
  }
  function parseSeq(indent) {
    const arr = [];
    while (true) {
      const p = peek();
      if (!p || p.indent !== indent || !p.content.startsWith("- ")) break;
      const rest = p.content.slice(2).trim();
      if (rest.startsWith("{") || rest.startsWith("[")) { arr.push(parseScalar(rest)); i++; }
      else if (/^[^:\s][^:]*:(\s|$)/.test(rest)) { lines[i] = { indent: indent + 2, content: rest }; arr.push(parseMap(indent + 2)); }
      else { arr.push(parseScalar(rest)); i++; }
    }
    return arr;
  }
  return parseBlock(lines.length ? lines[0].indent : 0);
}

const prettify = (id) => String(id || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim() || "Untitled";

function specToGraph(spec) {
  const teamIds = Array.isArray(spec.teams) ? spec.teams.slice() : [];
  const ref = new Set(teamIds);
  (spec.roles || []).forEach((r) => r.owner_team && ref.add(r.owner_team));
  (spec.approvals || []).forEach((a) => a.owner_team && ref.add(a.owner_team));
  (spec.external_dependencies || []).forEach((e) => e.owner_team && ref.add(e.owner_team));
  ref.forEach((t) => { if (!teamIds.includes(t)) teamIds.push(t); });
  if (!teamIds.length) teamIds.push("team");
  const teams = teamIds.map((id, i) => ({ id, name: prettify(id), color: TEAM_PALETTE[i % TEAM_PALETTE.length] }));
  const laneOf = (t) => (teamIds.includes(t) ? t : teamIds[0]);
  const laneIdx = (t) => Math.max(0, teamIds.indexOf(laneOf(t)));
  const Y = (i) => i * LANE_H + PAD + 22;

  const order = [];
  (spec.workflow || []).forEach((w) => { if (typeof w === "string") order.push(w); else if (w && w.approval) order.push(w.approval); });
  const orderIndex = {}; order.forEach((n, idx) => (orderIndex[n] = idx));
  const XCOL = 260, XGAP = 270;
  let overflow = order.length;
  const xOfName = (nm) => XCOL + ((nm in orderIndex) ? orderIndex[nm] : overflow++) * XGAP;

  const nodes = [], nameToId = {};
  const addTaskLike = (rec, type) => {
    const id = uid("n"); nameToId[rec.name] = id;
    const reusable = !!rec.reusable, su = rec.suitability || {};
    nodes.push({
      id, type, team: laneOf(rec.owner_team), label: rec.label || prettify(rec.name),
      x: xOfName(rec.name), y: Y(laneIdx(rec.owner_team)),
      systems: type === "task" ? (rec.target_systems || []).slice() : [],
      inputs: type === "task" ? (rec.inputs || []).slice() : [],
      integration: "api", reuseClaim: reusable, reuseParam: reusable, reuseOwner: reusable,
      metrics: type === "task" && rec.metrics ? { resources: rec.metrics.resources ?? 1, processTime: rec.metrics.process_time ?? 0, leadTime: rec.metrics.lead_time ?? 0, pctCA: rec.metrics.pct_complete_accurate ?? 100 } : undefined,
      scores: type === "task" ? { frequency: su.frequency ?? 3, standardisation: su.standardisation ?? 3, errorProneness: su.error_proneness ?? 3, complexity: su.complexity ?? 3 } : {},
    });
  };
  (spec.roles || []).forEach((r) => addTaskLike(r, "task"));
  (spec.approvals || []).forEach((a) => addTaskLike(a, "approval"));
  (spec.external_dependencies || []).forEach((e) => {
    const id = uid("n"); nameToId[e.name] = id;
    const nb = (e.consumed_by || [])[0];
    const ex = (nb && nb in orderIndex) ? XCOL + orderIndex[nb] * XGAP + 60 : XCOL + overflow++ * XGAP;
    nodes.push({ id, type: "external", team: laneOf(e.owner_team), label: prettify(e.name), x: ex, y: Y(laneIdx(e.owner_team)), integration: e.integration || "api", systems: [], inputs: [], scores: {} });
  });

  const edges = [], seen = new Set();
  const addEdge = (fromName, toName, type, artifact) => {
    const s = nameToId[fromName], t = nameToId[toName]; if (!s || !t) return;
    const k = s + "|" + t; if (seen.has(k)) return; seen.add(k);
    edges.push({ id: uid("e"), source: s, target: t, type: type || "sequence", artifact: artifact || "" });
  };
  (spec.roles || []).forEach((r) => (r.consumes || []).forEach((c) => addEdge(c.from, r.name, "data", c.artifact)));
  (spec.roles || []).forEach((r) => (r.depends_on || []).forEach((d) => addEdge(d, r.name, "sequence", "")));
  (spec.approvals || []).forEach((a) => (a.depends_on || []).forEach((d) => addEdge(d, a.name, "sequence", "")));
  (spec.external_dependencies || []).forEach((e) => (e.consumed_by || []).forEach((nb) => addEdge(nb, e.name, "sequence", "")));

  const wf = [...(spec.roles || []), ...(spec.approvals || [])];
  const depended = new Set(); wf.forEach((r) => (r.depends_on || []).forEach((d) => depended.add(d)));
  const roots = wf.filter((r) => !(r.depends_on || []).length);
  const leaves = wf.filter((r) => !depended.has(r.name));
  if (roots.length) {
    const li = laneIdx(roots[0].owner_team);
    nameToId["__start"] = uid("n");
    nodes.push({ id: nameToId["__start"], type: "start", team: teamIds[li], label: "Trigger", x: 20, y: Y(li), systems: [], inputs: [], scores: {} });
    roots.forEach((r) => addEdge("__start", r.name, "sequence", ""));
  }
  if (leaves.length) {
    const li = laneIdx(leaves[0].owner_team);
    const maxX = nodes.reduce((m, n) => Math.max(m, n.x), 0);
    nameToId["__end"] = uid("n");
    nodes.push({ id: nameToId["__end"], type: "end", team: teamIds[li], label: "Done", x: maxX + XGAP, y: Y(li), systems: [], inputs: [], scores: {} });
    leaves.forEach((r) => addEdge(r.name, "__end", "sequence", ""));
  }

  return { teams, nodes, edges, processName: spec.process || "imported_process" };
}

const JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sdd-ansible/spec/process.schema.json",
  title: "SDD-Ansible Cross-Team Process Spec",
  type: "object",
  required: ["process", "teams", "roles", "workflow"],
  properties: {
    process: { type: "string", pattern: "^[a-z0-9_]+$" },
    teams: { type: "array", items: { type: "string" } },
    target_systems: { type: "array", items: { type: "string" } },
    roles: { type: "array", items: {
      type: "object", required: ["name", "owner_team", "priority_score", "band"],
      properties: {
        name: { type: "string" }, owner_team: { type: "string" },
        priority_score: { type: "number" }, band: { enum: ["quick_win", "plan", "defer"] }, reusable: { type: "boolean" },
          suitability: { type: "object", properties: { frequency: { type: "number" }, standardisation: { type: "number" }, error_proneness: { type: "number" }, complexity: { type: "number" } } },
          metrics: { type: "object", properties: { resources: { type: "number" }, process_time: { type: "number" }, lead_time: { type: "number" }, pct_complete_accurate: { type: "number" } } },
        depends_on: { type: "array", items: { type: "string" } },
        consumes: { type: "array", items: { type: "object", required: ["from", "artifact"] } },
        handoff: { type: "boolean" },
      } } },
    approvals: { type: "array", items: { type: "object", required: ["name", "owner_team"] } },
    external_dependencies: { type: "array", items: { type: "object", required: ["name", "integration"] } },
    handoffs: { type: "array", items: { type: "object", required: ["from", "to"] } },
    workflow: { type: "array" },
  },
};

/* ------------------------------------------------------------------ */
/*  Seed — cross-team environment provisioning                         */
/* ------------------------------------------------------------------ */
/* Lay out a mostly-linear automated flow: steps left-to-right in their lanes,
   plus optional external "report" nodes that named steps write to. */
function flow(teams, seq, externals) {
  const laneIdx = (t) => Math.max(0, teams.findIndex((x) => x.id === t));
  const Y = (i) => i * LANE_H + PAD + 22;
  const X = (i) => 20 + i * 250;
  const nodes = seq.map((st, i) => {
    const n = { id: `s_${i}`, type: st.type, team: st.team, label: st.label, x: X(i), y: Y(laneIdx(st.team)), systems: st.systems || [], inputs: st.inputs || [], integration: "api", scores: st.type === "task" ? (st.scores || { frequency: 5, standardisation: 5, errorProneness: 2, complexity: 2 }) : {} };
    if (st.type === "task") { n.metrics = st.metrics || { resources: 1, processTime: 5, leadTime: 10, pctCA: 98 }; if (st.reusable) { n.reuseClaim = true; n.reuseParam = true; n.reuseOwner = true; } }
    return n;
  });
  const edges = [];
  for (let i = 0; i < seq.length - 1; i++) edges.push({ id: uid("e"), source: `s_${i}`, target: `s_${i + 1}`, type: "sequence", artifact: "" });
  (externals || []).forEach((ex, k) => {
    const id = `x_${k}`;
    nodes.push({ id, type: "external", team: ex.team, label: ex.label, x: X(ex.at ?? seq.length - 1), y: Y(laneIdx(ex.team)), integration: ex.integration || "eda_event", systems: [], inputs: [], scores: {} });
    (ex.from || []).forEach((fi) => edges.push({ id: uid("e"), source: `s_${fi}`, target: id, type: "sequence", artifact: "" }));
  });
  return { teams, nodes, edges };
}

const T3 = [{ id: "platform", name: "Platform", color: "#0D9488" }, { id: "security", name: "Security", color: "#7C3AED" }, { id: "servicemgmt", name: "Service Mgmt", color: "#D97706" }];

function seed(variant = "current") {
  /* ---- to-be (automated) domain examples ---- */
  if (variant === "windows") return flow(T3, [
    { type: "start", team: "platform", label: "Server build requested" },
    { type: "task", team: "platform", label: "Provision Windows Server", systems: ["windows"], inputs: ["hostname", "ou", "size"], reusable: true, metrics: { resources: 1, processTime: 8, leadTime: 15, pctCA: 99 } },
    { type: "task", team: "security", label: "Apply CIS hardening", systems: ["windows"], inputs: ["cis_profile"], reusable: true, metrics: { resources: 1, processTime: 6, leadTime: 10, pctCA: 98 } },
    { type: "task", team: "platform", label: "Join AD & configure roles", systems: ["windows", "active_directory"], inputs: ["domain", "roles"], reusable: true, metrics: { resources: 1, processTime: 5, leadTime: 8, pctCA: 99 } },
    { type: "end", team: "platform", label: "Server ready" },
  ], [{ team: "servicemgmt", label: "ServiceNow CMDB", integration: "eda_event", from: [3], at: 3 }]);

  if (variant === "rhel") return flow(T3, [
    { type: "start", team: "platform", label: "Host build requested" },
    { type: "task", team: "platform", label: "Provision RHEL host", systems: ["rhel"], inputs: ["hostname", "subscription"], reusable: true, metrics: { resources: 1, processTime: 6, leadTime: 12, pctCA: 99 } },
    { type: "task", team: "platform", label: "Register & patch (Satellite)", systems: ["rhel", "satellite"], inputs: ["content_view"], reusable: true, metrics: { resources: 1, processTime: 5, leadTime: 10, pctCA: 98 } },
    { type: "task", team: "security", label: "Apply STIG hardening", systems: ["rhel"], inputs: ["stig_profile"], reusable: true, metrics: { resources: 1, processTime: 7, leadTime: 11, pctCA: 98 } },
    { type: "end", team: "platform", label: "Compliant host ready" },
  ], [{ team: "servicemgmt", label: "CMDB", integration: "eda_event", from: [3], at: 3 }]);

  if (variant === "aws") return flow(
    [{ id: "platform", name: "Cloud Platform", color: "#0D9488" }, { id: "security", name: "Security", color: "#7C3AED" }, { id: "servicemgmt", name: "Service Mgmt", color: "#D97706" }], [
    { type: "start", team: "platform", label: "Environment requested" },
    { type: "task", team: "platform", label: "Provision VPC & networking", systems: ["aws_vpc"], inputs: ["cidr", "region"], reusable: true, metrics: { resources: 1, processTime: 6, leadTime: 10, pctCA: 99 } },
    { type: "task", team: "platform", label: "Provision EC2 & storage", systems: ["aws_ec2", "aws_ebs"], inputs: ["instance_type", "ami"], reusable: true, metrics: { resources: 1, processTime: 8, leadTime: 14, pctCA: 99 } },
    { type: "task", team: "security", label: "Apply IAM guardrails", systems: ["aws_iam"], inputs: ["policy_set"], reusable: true, metrics: { resources: 1, processTime: 5, leadTime: 9, pctCA: 98 } },
    { type: "end", team: "platform", label: "Environment ready" },
  ], [{ team: "servicemgmt", label: "CMDB / cost tags", integration: "eda_event", from: [2, 3], at: 3 }]);

  if (variant === "network") return flow(
    [{ id: "network", name: "Network", color: "#2563EB" }, { id: "security", name: "Security", color: "#7C3AED" }, { id: "servicemgmt", name: "Service Mgmt", color: "#D97706" }], [
    { type: "start", team: "network", label: "Change requested" },
    { type: "task", team: "network", label: "Backup running config", systems: ["network_devices"], inputs: ["device_group"], reusable: true, metrics: { resources: 1, processTime: 4, leadTime: 6, pctCA: 99 } },
    { type: "approval", team: "servicemgmt", label: "Change approval (CAB)" },
    { type: "task", team: "network", label: "Push config (VLAN/ACL)", systems: ["network_devices"], inputs: ["config_template"], reusable: true, metrics: { resources: 1, processTime: 6, leadTime: 10, pctCA: 98 } },
    { type: "task", team: "security", label: "Compliance validation", systems: ["network_devices"], inputs: ["compliance_policy"], reusable: true, metrics: { resources: 1, processTime: 5, leadTime: 8, pctCA: 99 } },
    { type: "end", team: "network", label: "Change complete" },
  ], [{ team: "servicemgmt", label: "NetBox / CMDB", integration: "eda_event", from: [3, 4], at: 4 }]);

  if (variant === "openshift") return flow(T3, [
    { type: "start", team: "platform", label: "Onboarding requested" },
    { type: "task", team: "platform", label: "Provision OCP project", systems: ["openshift"], inputs: ["project_name", "team"], reusable: true, metrics: { resources: 1, processTime: 5, leadTime: 8, pctCA: 99 } },
    { type: "task", team: "security", label: "Apply RBAC, quotas & policy", systems: ["openshift", "rhacs"], inputs: ["quota_tier", "roles"], reusable: true, metrics: { resources: 1, processTime: 4, leadTime: 7, pctCA: 98 } },
    { type: "task", team: "platform", label: "Deploy workload (GitOps)", systems: ["openshift", "argocd"], inputs: ["app_repo", "image_tag"], reusable: true, metrics: { resources: 1, processTime: 6, leadTime: 10, pctCA: 98 } },
    { type: "end", team: "platform", label: "Workload running" },
  ], [{ team: "servicemgmt", label: "ServiceNow CMDB", integration: "eda_event", from: [3], at: 3 }]);

  const teams = [
    { id: "app", name: "App", color: "#2563EB" },
    { id: "platform", name: "Platform", color: "#0D9488" },
    { id: "netsec", name: "Network / Security", color: "#7C3AED" },
    { id: "servicemgmt", name: "Service Mgmt", color: "#D97706" },
  ];
  const Y = (i) => i * LANE_H + PAD + 22;

  if (variant === "automated") {
    // Future state: same deployment, automated with Ansible. Manual steps and
    // their handoffs are removed as waste; two reusable roles + a fast approval
    // remain; the CMDB is updated automatically via an EDA event.
    const nodes = [
      { id: "a_start", type: "start", team: "app", label: "Deployment requested", x: 20, y: Y(0), systems: [], inputs: [], scores: {} },
      { id: "a_prov", type: "task", team: "platform", label: "Provision environment", x: 280, y: Y(1),
        systems: ["aws_ec2"], inputs: ["env_name", "instance_type"], reuseClaim: true, reuseParam: true, reuseOwner: true,
        metrics: { resources: 1, processTime: 10, leadTime: 20, pctCA: 99 }, scores: { frequency: 5, standardisation: 5, errorProneness: 2, complexity: 2 } },
      { id: "a_appr", type: "approval", team: "netsec", label: "Security approval", x: 540, y: Y(2), systems: [], inputs: [], scores: {} },
      { id: "a_deploy", type: "task", team: "app", label: "Deploy application", x: 800, y: Y(0),
        systems: ["aws_ec2"], inputs: ["artifact_id"], reuseClaim: true, reuseParam: true, reuseOwner: true,
        metrics: { resources: 1, processTime: 6, leadTime: 12, pctCA: 98 }, scores: { frequency: 5, standardisation: 5, errorProneness: 2, complexity: 2 } },
      { id: "a_cmdb", type: "external", team: "servicemgmt", label: "CMDB", x: 1060, y: Y(3), integration: "eda_event", systems: [], inputs: [], scores: {} },
      { id: "a_end", type: "end", team: "app", label: "Live", x: 1080, y: Y(0), systems: [], inputs: [], scores: {} },
    ];
    const edges = [
      { id: uid("e"), source: "a_start", target: "a_prov", type: "sequence", artifact: "" },
      { id: uid("e"), source: "a_prov", target: "a_appr", type: "sequence", artifact: "" },
      { id: uid("e"), source: "a_appr", target: "a_deploy", type: "sequence", artifact: "" },
      { id: uid("e"), source: "a_prov", target: "a_cmdb", type: "sequence", artifact: "" },   // auto-registered
      { id: uid("e"), source: "a_deploy", target: "a_cmdb", type: "sequence", artifact: "" }, // auto-registered
      { id: uid("e"), source: "a_deploy", target: "a_end", type: "sequence", artifact: "" },
    ];
    return { teams, nodes, edges };
  }

  // Current state: the same deployment done manually. Ticket queues and manual
  // hand-offs balloon lead time; every cross-lane arrow is a handoff.
  const X = (i) => 20 + i * 245;
  const nodes = [
    { id: "c_start", type: "start", team: "app", label: "Deployment requested", x: X(0), y: Y(0), systems: [], inputs: [], scores: {} },
    { id: "c_ticket", type: "task", team: "app", label: "Raise infra ticket", x: X(1), y: Y(0),
      systems: ["itsm"], inputs: ["request_form"], metrics: { resources: 1, processTime: 15, leadTime: 120, pctCA: 85 }, scores: { frequency: 5, standardisation: 3, errorProneness: 4, complexity: 2 } },
    { id: "c_prov", type: "task", team: "platform", label: "Provision EC2 instance", x: X(2), y: Y(1),
      systems: ["aws_ec2"], inputs: ["instance_type", "ami_id", "subnet_id"], metrics: { resources: 1, processTime: 45, leadTime: 480, pctCA: 80 }, scores: { frequency: 5, standardisation: 4, errorProneness: 4, complexity: 3 } },
    { id: "c_fwreq", type: "task", team: "app", label: "Raise firewall request", x: X(3), y: Y(0),
      systems: ["itsm"], inputs: ["ports", "cidr"], metrics: { resources: 1, processTime: 10, leadTime: 90, pctCA: 80 }, scores: { frequency: 4, standardisation: 3, errorProneness: 4, complexity: 2 } },
    { id: "c_review", type: "approval", team: "netsec", label: "Security review", x: X(4), y: Y(2), systems: [], inputs: [], scores: {} },
    { id: "c_fw", type: "task", team: "netsec", label: "Configure firewall", x: X(5), y: Y(2),
      systems: ["firewalls"], inputs: ["ports", "cidr"], metrics: { resources: 1, processTime: 30, leadTime: 240, pctCA: 75 }, scores: { frequency: 4, standardisation: 3, errorProneness: 5, complexity: 3 } },
    { id: "c_deploy", type: "task", team: "app", label: "Deploy application", x: X(6), y: Y(0),
      systems: ["aws_ec2"], inputs: ["artifact_id"], metrics: { resources: 1, processTime: 40, leadTime: 180, pctCA: 80 }, scores: { frequency: 5, standardisation: 4, errorProneness: 4, complexity: 3 } },
    { id: "c_cmdb", type: "task", team: "servicemgmt", label: "Update CMDB", x: X(7), y: Y(3),
      systems: ["cmdb"], inputs: ["ci_details"], metrics: { resources: 1, processTime: 20, leadTime: 120, pctCA: 70 }, scores: { frequency: 4, standardisation: 4, errorProneness: 5, complexity: 1 } },
    { id: "c_smoke", type: "task", team: "app", label: "Manual smoke test", x: X(8), y: Y(0),
      systems: ["aws_ec2"], inputs: ["test_checklist"], metrics: { resources: 1, processTime: 25, leadTime: 60, pctCA: 75 }, scores: { frequency: 5, standardisation: 3, errorProneness: 4, complexity: 2 } },
    { id: "c_end", type: "end", team: "app", label: "Live", x: X(9), y: Y(0), systems: [], inputs: [], scores: {} },
  ];
  const edges = [
    { id: uid("e"), source: "c_start", target: "c_ticket", type: "sequence", artifact: "" },
    { id: uid("e"), source: "c_ticket", target: "c_prov", type: "sequence", artifact: "" },
    { id: uid("e"), source: "c_prov", target: "c_fwreq", type: "sequence", artifact: "" },
    { id: uid("e"), source: "c_fwreq", target: "c_review", type: "sequence", artifact: "" },
    { id: uid("e"), source: "c_review", target: "c_fw", type: "sequence", artifact: "" },
    { id: uid("e"), source: "c_fw", target: "c_deploy", type: "sequence", artifact: "" },
    { id: uid("e"), source: "c_deploy", target: "c_cmdb", type: "sequence", artifact: "" },
    { id: uid("e"), source: "c_cmdb", target: "c_smoke", type: "sequence", artifact: "" },
    { id: uid("e"), source: "c_smoke", target: "c_end", type: "sequence", artifact: "" },
  ];
  return { teams, nodes, edges };
}

/* ================================================================== */
/*  App                                                                */
/* ================================================================== */
export default function App() {
  const s0 = seed();
  const [teams, setTeams] = useState(s0.teams);
  const [nodes, setNodes] = useState(s0.nodes);
  const [edges, setEdges] = useState(s0.edges);
  const [processName, setProcessName] = useState("app_deploy_current");
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState("inspector");
  const [connecting, setConnecting] = useState(null);
  const [copied, setCopied] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState("");
  const [variant, setVariant] = useState("current");
  const [importMsg, setImportMsg] = useState(null);
  const fileRef = useRef(null);
  const worldRef = useRef(null);
  const drag = useRef(null);

  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const teamById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);
  const spec = useMemo(() => buildSpec(processName, nodes, edges, teams), [processName, nodes, edges, teams]);
  const yaml = useMemo(() => toYaml(spec), [spec]);
  const worldH = Math.max(teams.length * LANE_H, 420);
  const contentW = useMemo(() => Math.max(WORLD_W, nodes.reduce((m, n) => Math.max(m, n.x + NODE_W), 0) + 80), [nodes]);

  const local = useCallback((e) => {
    const r = worldRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  /* ---- teams ---- */
  const addTeam = () => {
    const id = uid("team");
    setTeams((ts) => [...ts, { id, name: `Team ${ts.length + 1}`, color: TEAM_PALETTE[ts.length % TEAM_PALETTE.length] }]);
  };
  const renameTeam = (id, name) => setTeams((ts) => ts.map((t) => (t.id === id ? { ...t, name } : t)));
  const recolorTeam = (id) => setTeams((ts) => ts.map((t) => (t.id === id ? { ...t, color: TEAM_PALETTE[(TEAM_PALETTE.indexOf(t.color) + 1) % TEAM_PALETTE.length] } : t)));
  const removeTeam = (id) => {
    if (teams.length <= 1) return;
    const fallback = teams.find((t) => t.id !== id).id;
    const fIdx = 0;
    setNodes((ns) => ns.map((n) => (n.team === id ? { ...n, team: teams[fIdx].id, y: clampToLane(n.y, fIdx) } : n)));
    setTeams((ts) => ts.filter((t) => t.id !== id));
  };

  /* ---- nodes / edges ---- */
  const addNode = (type) => {
    const n = {
      id: uid("n"), type, team: teams[0].id,
      label: type === "task" ? "New step" : type === "approval" ? "Approval" : type === "gateway" ? "Decision?" : type === "external" ? "External system" : type === "start" ? "Trigger" : "Done",
      x: 80, y: clampToLane(PAD + 22, 0),
      systems: [], inputs: [], integration: "api", reuseClaim: false, reuseParam: false, reuseOwner: false,
      metrics: type === "task" ? { resources: 1, processTime: 0, leadTime: 0, pctCA: 100 } : undefined,
      scores: type === "task" ? { frequency: 3, standardisation: 3, errorProneness: 3, complexity: 3 } : {},
    };
    setNodes((ns) => [...ns, n]);
    setSel({ kind: "node", id: n.id }); setTab("inspector");
  };
  const updateNode = (id, patch) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const updateScore = (id, key, val) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, scores: { ...n.scores, [key]: val } } : n)));
  const setNodeTeam = (id, teamId) => {
    const idx = laneIndex(teams, teamId);
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, team: teamId, y: clampToLane(n.y, idx) } : n)));
  };
  const updateEdge = (id, patch) => setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const deleteNode = (id) => { setNodes((ns) => ns.filter((n) => n.id !== id)); setEdges((es) => es.filter((e) => e.source !== id && e.target !== id)); setSel(null); };
  const deleteEdge = (id) => { setEdges((es) => es.filter((e) => e.id !== id)); setSel(null); };

  /* ---- pointer ---- */
  const onNodeDown = (e, n) => {
    e.stopPropagation(); if (connecting) return;
    const p = local(e); drag.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y };
    setSel({ kind: "node", id: n.id }); setTab("inspector");
  };
  const onHandleDown = (e, n) => { e.stopPropagation(); const p = local(e); setConnecting({ from: n.id, x: p.x, y: p.y }); };
  const onNodeUp = (e, n) => {
    if (connecting && connecting.from !== n.id) {
      e.stopPropagation();
      if (!edges.some((ed) => ed.source === connecting.from && ed.target === n.id))
        setEdges((es) => [...es, { id: uid("e"), source: connecting.from, target: n.id, type: "sequence", artifact: "" }]);
      setConnecting(null);
    }
  };
  const onWorldMove = (e) => {
    if (drag.current) {
      const p = local(e);
      const nx = Math.max(0, Math.round(p.x - drag.current.dx));
      const cy = Math.round(p.y - drag.current.dy) + NODE_H / 2;
      const idx = Math.min(teams.length - 1, Math.max(0, Math.floor(cy / LANE_H)));
      updateNode(drag.current.id, { x: nx, y: clampToLane(Math.round(p.y - drag.current.dy), idx), team: teams[idx].id });
    } else if (connecting) { const p = local(e); setConnecting((c) => ({ ...c, x: p.x, y: p.y })); }
  };
  const onWorldUp = () => { drag.current = null; setConnecting(null); };

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if ((e.key === "Delete" || e.key === "Backspace") && sel && tag !== "INPUT" && tag !== "TEXTAREA") {
        sel.kind === "node" ? deleteNode(sel.id) : deleteEdge(sel.id);
      }
      if (e.key === "Escape") setConnecting(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, edges]); // eslint-disable-line

  const copy = async (text, key) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1400); } catch {} };
  const download = (text, name, type) => { const b = new Blob([text], { type }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); };
  const PROC_NAME = { current: "app_deploy_current", automated: "app_deploy_automated", windows: "windows_server_build", rhel: "rhel_host_build", aws: "aws_environment_build", network: "network_change", openshift: "openshift_onboarding" };
  const loadExample = (v) => { const f = seed(v); setTeams(f.teams); setNodes(f.nodes); setEdges(f.edges); setProcessName(PROC_NAME[v] || "imported_process"); setVariant(v); setSel(null); };
  const flash = (ok, text) => { setImportMsg({ ok, text }); setTimeout(() => setImportMsg(null), 4500); };
  const onImportFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const spec = parseYaml(String(reader.result));
        if (!spec || typeof spec !== "object" || (!spec.roles && !spec.workflow)) throw new Error("shape");
        const g = specToGraph(spec);
        if (!g.teams.length || !g.nodes.length) throw new Error("empty");
        setTeams(g.teams); setNodes(g.nodes); setEdges(g.edges); setProcessName(g.processName); setSel(null);
        const nRoles = g.nodes.filter((n) => n.type === "task").length;
        flash(true, `Imported ${nRoles} role(s) across ${g.teams.length} team(s). Positions were auto-laid-out \u2014 drag to tidy.`);
      } catch { flash(false, "Couldn't read that file. Import a workflow spec (.yml) exported by this tool."); }
    };
    reader.onerror = () => flash(false, "Couldn't read that file.");
    reader.readAsText(file);
    e.target.value = "";
  };
  const clearGraph = () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); return; }
    setNodes([]); setEdges([]); setSel(null); setConfirmClear(false);   // keeps the lanes so you can brainstorm fresh
  };
  const exportSvg = () => { const { svg } = buildExportSVG(processName, nodes, edges, teams, worldH); download(svg, `${slug(processName)}.canvas.svg`, "image/svg+xml"); };
  const exportPdf = () => {
    setExporting("pdf");
    const { svg, width, height } = buildExportSVG(processName, nodes, edges, teams, worldH);
    const img = new Image();
    const finishSvg = () => { download(svg, `${slug(processName)}.canvas.svg`, "image/svg+xml"); setExporting(""); };
    img.onload = () => {
      try {
        const scale = 2, cv = document.createElement("canvas");
        cv.width = width * scale; cv.height = height * scale;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        const jpeg = cv.toDataURL("image/jpeg", 0.92);
        const pdf = jpegDataUrlToPdf(jpeg, cv.width, cv.height);
        download(pdf, `${slug(processName)}.canvas.pdf`, "application/pdf");
        setExporting("");
      } catch { finishSvg(); }   // canvas tainted / unsupported -> fall back to the vector SVG
    };
    img.onerror = finishSvg;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  };

  /* ---- edge geometry: right-center -> left-center ---- */
  const outA = (n) => ({ x: n.x + NODE_W, y: n.y + NODE_H / 2 });
  const inA = (n) => ({ x: n.x, y: n.y + NODE_H / 2 });
  const path = (a, b) => { const off = Math.max(60, Math.abs(b.x - a.x) * 0.4); return `M ${a.x} ${a.y} C ${a.x + off} ${a.y}, ${b.x - off} ${b.y}, ${b.x} ${b.y}`; };

  const selNode = sel?.kind === "node" ? nodeById[sel.id] : null;
  const selEdge = sel?.kind === "edge" ? edges.find((e) => e.id === sel.id) : null;

  const handoffRows = useMemo(() => spec.handoffs, [spec]);

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: T.ink, background: "#F8FAFC", minHeight: "100%" }}>
      <style>{css}</style>

      <header className="hd">
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div className="logo"><GitBranch size={18} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="title">Automation Discovery Canvas</div>
            <div className="tag">Cross-team process &rarr; scored backlog &rarr; AAP workflow spec</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <label className="plabel">process</label>
          <input className="pinput mono" value={processName} onChange={(e) => setProcessName(e.target.value)} spellCheck={false} />
          <button className={`btn ghost ${confirmClear ? "danger" : ""}`} onClick={clearGraph} title="Clear all nodes and edges (keeps the lanes)">
            <Eraser size={14} /> {confirmClear ? "Confirm clear?" : "Clear"}
          </button>
          <select className="pinput" style={{ width: "auto", cursor: "pointer" }} value={variant} onChange={(e) => loadExample(e.target.value)} title="Load an example process">
            <optgroup label="Before / after">
              <option value="current">Current (manual)</option>
              <option value="automated">Automated (Ansible)</option>
            </optgroup>
            <optgroup label="To-be by domain">
              <option value="windows">Windows</option>
              <option value="rhel">RHEL</option>
              <option value="aws">AWS</option>
              <option value="network">Network</option>
              <option value="openshift">OpenShift / Containers</option>
            </optgroup>
          </select>
          <input ref={fileRef} type="file" accept=".yml,.yaml,text/yaml,text/plain" style={{ display: "none" }} onChange={onImportFile} />
          <button className="btn ghost" onClick={() => fileRef.current?.click()} title="Import a workflow spec (YAML) to edit"><Upload size={14} /> Import</button>
          <button className="btn ghost" onClick={exportSvg} title="Download the diagram as a vector SVG"><Download size={14} /> SVG</button>
          <button className="btn primary" onClick={exportPdf} disabled={exporting === "pdf"} title="Export the diagram to a PDF file">
            <FileDown size={14} /> {exporting === "pdf" ? "Exporting\u2026" : "PDF"}
          </button>
        </div>
      </header>

      {importMsg ? <div className={`toast ${importMsg.ok ? "ok" : "err"}`}>{importMsg.text}</div> : null}

      <div className="main">
        {/* palette */}
        <aside className="pal">
          <div className="seclabel"><Users size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />Teams (lanes)</div>
          {teams.map((t) => (
            <div key={t.id} className="teamrow">
              <button className="swatch" style={{ background: t.color }} onClick={() => recolorTeam(t.id)} title="Change colour" />
              <input className="teamname" value={t.name} onChange={(e) => renameTeam(t.id, e.target.value)} />
              {teams.length > 1 && <button className="xbtn" onClick={() => removeTeam(t.id)} title="Remove lane">&times;</button>}
            </div>
          ))}
          <button className="btn ghost sm full" onClick={addTeam}><Plus size={13} /> Add lane</button>

          <div className="seclabel">Add node</div>
          {[
            ["task", "Step / Role"], ["approval", "Approval gate"], ["gateway", "Decision"],
            ["external", "External dependency"], ["start", "Trigger"], ["end", "Terminus"],
          ].map(([type, name]) => {
            const M = NODE_META[type];
            return (
              <button key={type} className="palbtn" onClick={() => addNode(type)}>
                <span className="palicon" style={{ background: M.color }}><M.icon size={13} color="#fff" /></span>
                <span className="palname">{name}</span>
                <Plus size={13} color={T.faint} style={{ marginLeft: "auto" }} />
              </button>
            );
          })}

          <div className="note">
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Drag a card between lanes to change its owning team. Pull from the dot on a card&rsquo;s right edge to connect. Every arrow that crosses a lane is a handoff.</span>
          </div>
        </aside>

        {/* canvas */}
        <section className="cv">
          <div className="vp">
            <div className="world" ref={worldRef} style={{ width: contentW, height: worldH }}
              onPointerMove={onWorldMove} onPointerUp={onWorldUp} onPointerDown={() => setSel(null)}>

              {/* lanes */}
              {teams.map((t, i) => (
                <div key={t.id} className="lane" style={{ top: i * LANE_H, height: LANE_H, width: contentW, background: t.color + "0F", borderBottomColor: T.line }}>
                  <span className="lanelabel" style={{ color: t.color, borderColor: t.color }}>
                    <span className="lanedot" style={{ background: t.color }} /> {t.name}
                  </span>
                </div>
              ))}

              {/* edges */}
              <svg className="edges" width={contentW} height={worldH}>
                <defs>
                  {["arrow", "arrowSel", "arrowData", "arrowExt"].map((id, k) => (
                    <marker key={id} id={id} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L8,3 L0,6 Z" fill={[T.faint, T.accent, T.data, T.external][k]} />
                    </marker>
                  ))}
                </defs>
                {edges.map((e) => {
                  const sN = nodeById[e.source], tN = nodeById[e.target]; if (!sN || !tN) return null;
                  const a = outA(sN), b = inA(tN), d = path(a, b);
                  const isSel = sel?.kind === "edge" && sel.id === e.id;
                  const isExt = sN.type === "external" || tN.type === "external";
                  const isData = e.type === "data";
                  const cross = (sN.type === "task" || sN.type === "approval") && (tN.type === "task" || tN.type === "approval") && sN.team !== tN.team;
                  const stroke = isSel ? T.accent : isExt ? T.external : isData ? T.data : (cross ? T.ink : T.faint);
                  const dash = isExt ? "2 5" : isData ? "7 5" : "0";
                  const marker = isSel ? "arrowSel" : isExt ? "arrowExt" : isData ? "arrowData" : "arrow";
                  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                  return (
                    <g key={e.id}>
                      <path d={d} stroke="transparent" strokeWidth="16" fill="none" style={{ cursor: "pointer" }}
                        onPointerDown={(ev) => { ev.stopPropagation(); setSel({ kind: "edge", id: e.id }); setTab("inspector"); }} />
                      <path d={d} stroke={stroke} strokeWidth={isSel ? 2.6 : cross || isData || isExt ? 2 : 1.6}
                        strokeDasharray={dash} fill="none" markerEnd={`url(#${marker})`} />
                      {isData && e.artifact ? (
                        <g transform={`translate(${mid.x}, ${mid.y})`}>
                          <rect x="-52" y="-11" width="104" height="22" rx="6" fill="#fff" stroke={isSel ? T.accent : T.data} />
                          <text x="0" y="4" textAnchor="middle" className="cond" fill={T.data}>{truncate(e.artifact, 15)}</text>
                        </g>
                      ) : cross && !isExt ? (
                        <circle cx={mid.x} cy={mid.y} r="5" fill={teamById[sN.team]?.color || T.accent} stroke="#fff" strokeWidth="1.5" />
                      ) : null}
                    </g>
                  );
                })}
                {connecting ? (() => { const sN = nodeById[connecting.from]; if (!sN) return null; return <path d={path(outA(sN), { x: connecting.x, y: connecting.y })} stroke={T.accent} strokeWidth="2" strokeDasharray="5 4" fill="none" />; })() : null}
              </svg>

              {nodes.length === 0 ? (
                <div className="emptycanvas">
                  <div className="emptycanvas-inner">
                    Blank canvas. Add nodes from the left to map a process, or hit <b>Example</b> to load the sample flow.
                  </div>
                </div>
              ) : null}

              {/* nodes */}
              {nodes.map((n) => {
                const M = NODE_META[n.type], isSel = sel?.kind === "node" && sel.id === n.id, isTask = n.type === "task";
                const sc = isTask ? scoreOf(n) : null, band = isTask ? bandOf(sc) : null;
                return (
                  <div key={n.id} className={`node ${n.type === "external" ? "ext" : ""}`}
                    style={{ left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H, borderColor: isSel ? M.color : T.line,
                      boxShadow: isSel ? `0 0 0 2px ${M.color}33, 0 6px 16px rgba(15,23,42,.12)` : "0 2px 8px rgba(15,23,42,.06)" }}
                    onPointerDown={(e) => onNodeDown(e, n)} onPointerUp={(e) => onNodeUp(e, n)}>
                    <span className="rail" style={{ background: M.color }} />
                    <div className="nbody">
                      <div className="ntop">
                        <span className="kind" style={{ color: M.color }}><M.icon size={12} /> {M.kind}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
                          {isTask && isReusable(n) ? <Repeat size={12} color={T.quick} /> : null}
                          {isTask ? <span className="scorechip" style={{ background: band.color }}>{sc}</span> : null}
                        </span>
                      </div>
                      <div className="nlabel">{n.label || <span style={{ color: T.faint }}>untitled</span>}</div>
                      {isTask ? <div className="slug mono">{slug(n.label)}</div>
                        : n.type === "external" ? <div className="slug mono" style={{ color: T.external }}>{n.integration || "manual"}</div>
                        : n.type === "gateway" ? <div className="slug mono">routes {edges.filter((e) => e.source === n.id).length} branch(es)</div>
                        : null}
                    </div>
                    {n.type !== "end" ? <span className="handle" style={{ borderColor: M.color }} title="Drag to connect" onPointerDown={(e) => onHandleDown(e, n)} /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* panel */}
        <aside className="panel">
          <div className="tabs">
            {[["inspector", "Edit", Info], ["backlog", "Backlog", ListOrdered], ["handoffs", "Handoffs", ArrowLeftRight], ["metrics", "Metrics", Timer], ["export", "Export", FileCode]].map(([k, label, Icon]) => (
              <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}><Icon size={13} /> {label}</button>
            ))}
          </div>
          <div className="pbody">
            {tab === "inspector" && <Inspector node={selNode} edge={selEdge} teams={teams} nodeById={nodeById} teamById={teamById}
              onNode={updateNode} onScore={updateScore} onEdge={updateEdge} onTeam={setNodeTeam} onDelNode={deleteNode} onDelEdge={deleteEdge} />}

            {tab === "backlog" && (
              <div>
                <div className="seclabel" style={{ marginTop: 0 }}>Prioritised backlog &middot; {spec.roles.length} role{spec.roles.length === 1 ? "" : "s"}</div>
                <p className="help">Ranked by suitability. Roles flagged <span style={{ color: T.accent, fontWeight: 600 }}>handoff</span> depend on another team &mdash; those are the ones to sequence carefully.</p>
                {!spec.roles.length && <Empty text="Add a Step node to populate the backlog." />}
                {spec.roles.map((r, i) => {
                  const band = bandOf(r.priority_score), tm = teamById[r.owner_team];
                  return (
                    <div key={r.name} className="blrow">
                      <div className="blrank">{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="bltop">
                          <span className="bllabel">{r.label}</span>
                          <span className="blband" style={{ color: band.color, borderColor: band.color }}>{band.label}</span>
                        </div>
                        <div className="blbar"><span style={{ width: `${r.priority_score * 10}%`, background: band.color }} /></div>
                        <div className="blmeta">
                          <span className="teamtag" style={{ color: tm?.color, borderColor: tm?.color }}>{tm?.name || r.owner_team}</span>
                          {r.reusable && <span className="reuseflag"><Repeat size={10} /> reusable</span>}
                          {r.handoff && <span className="hoflag">handoff</span>}
                          <span className="mono" style={{ color: T.faint }}>{r.priority_score}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "handoffs" && (
              <div>
                <div className="seclabel" style={{ marginTop: 0 }}>Cross-team handoffs</div>
                <div className="hostat">
                  <div><div className="hostatbig">{handoffRows.length}</div><div className="hostatlbl">handoffs</div></div>
                  <div><div className="hostatbig">{spec.external_dependencies.length}</div><div className="hostatlbl">external deps</div></div>
                  <div><div className="hostatbig">{new Set(handoffRows.flatMap((h) => [h.from_team, h.to_team])).size}</div><div className="hostatlbl">teams involved</div></div>
                </div>
                <p className="help">Every row is a point where work leaves one team and enters another &mdash; the coordination map, and the wait-time your automation removes.</p>
                {!handoffRows.length && <Empty text="No cross-team handoffs yet. Connect steps owned by different lanes." />}
                {handoffRows.map((h, i) => (
                  <div key={i} className="horow">
                    <span className="teamtag" style={{ color: teamById[h.from_team]?.color, borderColor: teamById[h.from_team]?.color }}>{teamById[h.from_team]?.name || h.from_team}</span>
                    <ArrowRight size={12} color={T.faint} />
                    <span className="teamtag" style={{ color: teamById[h.to_team]?.color, borderColor: teamById[h.to_team]?.color }}>{teamById[h.to_team]?.name || h.to_team}</span>
                    <span className="hotype mono">{h.type === "data" ? `data: ${h.artifact}` : h.type}</span>
                  </div>
                ))}
                {spec.external_dependencies.length ? (
                  <>
                    <div className="seclabel">External dependencies</div>
                    {spec.external_dependencies.map((e) => (
                      <div key={e.name} className="exrow">
                        <ExternalLink size={13} color={T.external} />
                        <span className="mono" style={{ fontSize: 12 }}>{e.name}</span>
                        <span className="hotype mono" style={{ marginLeft: "auto" }}>{e.integration}</span>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            )}

            {tab === "metrics" && (() => {
              const b = spec.baseline || { count: 0, totalPT: 0, totalLT: 0, resources: 0, activityRatio: null, rolledCA: null };
              const wait = Math.max(0, b.totalLT - b.totalPT);
              return (
                <div>
                  <div className="seclabel" style={{ marginTop: 0 }}>Metrics-based process mapping</div>
                  <p className="help">A baseline of the manual process, in the style of the Open Practice Library MBPM practice. Set each step's metrics in the Edit tab.</p>
                  {!b.count && <Empty text="Add Step nodes and set their process metrics to see the baseline." />}
                  {b.count ? (
                    <>
                      <div className="mstat">
                        <div><div className="mstatbig mono">{b.totalPT}<span className="munitbig">min</span></div><div className="mstatlbl">Total process time</div></div>
                        <div><div className="mstatbig mono">{b.totalLT}<span className="munitbig">min</span></div><div className="mstatlbl">Total lead time</div></div>
                        <div><div className="mstatbig mono" style={{ color: ratioColor(b.activityRatio) }}>{b.activityRatio == null ? "\u2014" : b.activityRatio}<span className="munitbig">%</span></div><div className="mstatlbl">Activity ratio</div></div>
                        <div><div className="mstatbig mono" style={{ color: caColor(b.rolledCA) }}>{b.rolledCA == null ? "\u2014" : b.rolledCA}<span className="munitbig">%</span></div><div className="mstatlbl">Rolled %C&amp;A</div></div>
                      </div>
                      <p className="help">
                        <b>Activity ratio</b> is the share of lead time actually spent working ({b.totalPT} of {b.totalLT} min) &mdash; the other {wait} min is waiting, most of it at cross-team handoffs. <b>Rolled %C&amp;A</b> compounds first-pass quality across every step.
                      </p>
                      <div className="seclabel">Per step</div>
                      {spec.roles.map((r) => (
                        <div key={r.name} className="mrow">
                          <span className="mrowlabel">{r.label}</span>
                          <span className="mrowval">PT {r.metrics.process_time}</span>
                          <span className="mrowval">LT {r.metrics.lead_time}</span>
                          <span className="mrowval" style={{ color: caColor(r.metrics.pct_complete_accurate) }}>{r.metrics.pct_complete_accurate}%</span>
                        </div>
                      ))}
                    </>
                  ) : null}
                </div>
              );
            })()}

            {tab === "export" && (
              <div>
                <div className="exphead">
                  <span className="seclabel" style={{ margin: 0 }}>AAP workflow spec (YAML)</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => copy(yaml, "yaml")}>{copied === "yaml" ? <Check size={13} /> : <Copy size={13} />} Copy</button>
                    <button className="btn ghost sm" onClick={() => download(yaml, `${spec.process}.spec.yml`, "text/yaml")}><Download size={13} /> .yml</button>
                  </div>
                </div>
                <pre className="code mono">{yaml}</pre>
                <div className="exphead" style={{ marginTop: 16 }}>
                  <span className="seclabel" style={{ margin: 0 }}>JSON Schema</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => copy(JSON.stringify(JSON_SCHEMA, null, 2), "schema")}>{copied === "schema" ? <Check size={13} /> : <Copy size={13} />} Copy</button>
                    <button className="btn ghost sm" onClick={() => download(JSON.stringify(JSON_SCHEMA, null, 2), "process.schema.json", "application/json")}><Download size={13} /> .json</button>
                  </div>
                </div>
                <p className="help">Validate the spec against this schema in CI so every discovery session yields a consistent SDD-Ansible input.</p>
                <pre className="code mono" style={{ maxHeight: 170 }}>{JSON.stringify(JSON_SCHEMA, null, 2)}</pre>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inspector                                                          */
/* ------------------------------------------------------------------ */
function Inspector({ node, edge, teams, nodeById, teamById, onNode, onScore, onEdge, onTeam, onDelNode, onDelEdge }) {
  if (edge) {
    const sN = nodeById[edge.source], tN = nodeById[edge.target];
    const isExt = sN?.type === "external" || tN?.type === "external";
    const cross = sN && tN && sN.team !== tN.team;
    return (
      <div>
        <RowHead title="Connection" onDel={() => onDelEdge(edge.id)} />
        <div className="flow mono">{sN?.label || "?"} <ArrowRight size={13} /> {tN?.label || "?"}</div>
        {cross && !isExt ? <div className="crosstag">crosses {teamById[sN.team]?.name} &rarr; {teamById[tN.team]?.name} &mdash; this is a handoff</div> : null}
        {isExt ? <p className="help">Touches an external system, so it&rsquo;s treated as an external dependency in the export.</p> : null}
        <Field label="Dependency type">
          <div className="seg">
            {[["sequence", "Sequence"], ["data", "Data"]].map(([v, l]) => (
              <button key={v} className={`segbtn ${(edge.type || "sequence") === v ? "on" : ""}`} onClick={() => onEdge(edge.id, { type: v })}>{l}</button>
            ))}
          </div>
        </Field>
        {(edge.type || "sequence") === "data" ? (
          <Field label="Artifact passed ( needs output from )">
            <input className="input mono" placeholder="cidr_block" value={edge.artifact || ""} onChange={(e) => onEdge(edge.id, { artifact: e.target.value })} spellCheck={false} />
          </Field>
        ) : <p className="help">Sequence = runs after. Switch to Data when this step needs an output (an artifact) from the previous one.</p>}
      </div>
    );
  }

  if (!node) return <Empty text="Select a node or an edge to edit it." />;
  const isTask = node.type === "task";
  return (
    <div>
      <RowHead title={NODE_META[node.type].kind} color={NODE_META[node.type].color} onDel={() => onDelNode(node.id)} />
      <Field label="Label"><input className="input" value={node.label} onChange={(e) => onNode(node.id, { label: e.target.value })} /></Field>

      <Field label="Owning team (lane)">
        <select className="input" value={node.team} onChange={(e) => onTeam(node.id, e.target.value)}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>

      {node.type === "external" && (
        <Field label="Integration">
          <select className="input" value={node.integration || "api"} onChange={(e) => onNode(node.id, { integration: e.target.value })}>
            <option value="eda_event">EDA event</option>
            <option value="api">API call</option>
            <option value="manual">Manual handoff</option>
          </select>
        </Field>
      )}

      {isTask && (
        <>
          <div className="slugline">role: <span className="mono">{slug(node.label)}</span></div>
          <Field label="Target systems (comma-separated)">
            <input className="input mono" value={(node.systems || []).join(", ")} placeholder="openshift, firewalls" onChange={(e) => onNode(node.id, { systems: splitList(e.target.value) })} spellCheck={false} />
          </Field>
          <Field label="Inputs / variables (comma-separated)">
            <input className="input mono" value={(node.inputs || []).join(", ")} placeholder="project_name, cidr_block" onChange={(e) => onNode(node.id, { inputs: splitList(e.target.value) })} spellCheck={false} />
          </Field>
          <div className="seclabel"><Gauge size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Automation suitability</div>
          {[["frequency", "How often it runs", "rare", "constant"], ["standardisation", "How rule-based it is", "ad-hoc", "standard"], ["errorProneness", "Manual error risk today", "low", "high"], ["complexity", "Effort to automate", "trivial", "hard"]].map(([key, label, lo, hi]) => (
            <div key={key} className="slider">
              <div className="sliderhead"><span>{label}</span><span className="sliderval mono">{node.scores?.[key] ?? 3}</span></div>
              <input type="range" min="1" max="5" step="1" value={node.scores?.[key] ?? 3} onChange={(e) => onScore(node.id, key, Number(e.target.value))} />
              <div className="sliderends"><span>{lo}</span><span>{hi}</span></div>
            </div>
          ))}
          <button className={`reusetoggle ${node.reuseClaim ? "on" : ""}`} onClick={() => onNode(node.id, { reuseClaim: !node.reuseClaim })}>
            <span className="reuseswitch"><span className="reuseknob" /></span>
            <span className="reusetext">
              <span className="reusetitle"><Repeat size={13} /> Reusable by other teams</span>
              <span className="reusehint">Confirm both checks to promote to quick win</span>
            </span>
          </button>
          {node.reuseClaim && (
            <div className="reusechecks">
              <label className="reusecheck">
                <input type="checkbox" checked={!!node.reuseParam} onChange={(e) => onNode(node.id, { reuseParam: e.target.checked })} />
                <span>Parameterised &mdash; no team-specific hard-coding</span>
              </label>
              <label className="reusecheck">
                <input type="checkbox" checked={!!node.reuseOwner} onChange={(e) => onNode(node.id, { reuseOwner: e.target.checked })} />
                <span>Named owner for the shared version</span>
              </label>
              <div className={`reusestatus ${isReusable(node) ? "ok" : "pending"}`}>
                {isReusable(node) ? "Verified reusable \u2014 promoted to quick win" : "Claimed only \u2014 confirm both to promote"}
              </div>
            </div>
          )}
          <div className="scorebox">
            <div><div className="scorebig mono">{scoreOf(node)}</div><div className="scorelbl">suitability / 10{isReusable(node) ? " \u00b7 reuse floor" : ""}</div></div>
            <span className="blband" style={{ color: bandOf(scoreOf(node)).color, borderColor: bandOf(scoreOf(node)).color }}>{bandOf(scoreOf(node)).label}</span>
          </div>

          <div className="seclabel"><Timer size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Process metrics (MBPM)</div>
          <div className="mbpmgrid">
            {[["resources", "Resources", "people"], ["processTime", "Process time", "min"], ["leadTime", "Lead time", "min"], ["pctCA", "% Complete & Accurate", "%"]].map(([key, label, unit]) => (
              <label key={key} className="mfield">
                <span className="mlbl">{label}</span>
                <span className="minputwrap">
                  <input type="number" className="minput mono" min="0" value={metricsOf(node)[key]}
                    onChange={(e) => { let v = Number(e.target.value) || 0; if (v < 0) v = 0; if (key === "pctCA") v = Math.min(100, v); onNode(node.id, { metrics: { ...metricsOf(node), [key]: v } }); }} />
                  <span className="munit">{unit}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="help">Baseline the manual process. Lead time far above process time means the step mostly waits &mdash; see the Metrics tab for the rollup.</p>
        </>
      )}

      {node.type === "approval" && <p className="help">Maps to an AAP workflow <span className="mono">approval</span> node. The owning team is who signs off before the flow proceeds.</p>}
      {node.type === "gateway" && <p className="help">A Decision doesn&rsquo;t become a role. Its outgoing edges become <span className="mono">when:</span> branches. Select each edge to set its condition via the Data/artifact field.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Atoms                                                              */
/* ------------------------------------------------------------------ */
function Field({ label, children }) { return <label className="field"><span className="fieldlbl">{label}</span>{children}</label>; }
function RowHead({ title, onDel, color }) {
  return (
    <div className="rowhead">
      <span className="rowtitle" style={{ color: color || T.ink }}>{title}</span>
      <button className="del" onClick={onDel} title="Delete (or press Del)"><Trash2 size={13} /> Delete</button>
    </div>
  );
}
function Empty({ text }) { return <div className="empty">{text}</div>; }

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const css = `
.mono { font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace; }
.hd { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; padding:12px 18px; background:#fff; border-bottom:1px solid ${T.line}; }
.logo { width:34px; height:34px; border-radius:9px; background:${T.accentSoft}; color:${T.accent}; display:flex; align-items:center; justify-content:center; }
.title { font-size:15px; font-weight:650; letter-spacing:-.01em; }
.tag { font-size:12px; color:${T.sub}; }
.plabel { font-size:11px; color:${T.faint}; text-transform:uppercase; letter-spacing:.08em; }
.pinput { font-size:13px; padding:6px 9px; border:1px solid ${T.line}; border-radius:7px; width:190px; color:${T.ink}; background:#F8FAFC; outline:none; }
.pinput:focus { border-color:${T.accent}; background:#fff; }
.btn { display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:550; padding:6px 10px; border-radius:7px; border:1px solid ${T.line}; background:#fff; color:${T.ink}; cursor:pointer; }
.btn.sm { padding:4px 8px; font-size:11.5px; }
.btn.full { width:100%; justify-content:center; margin-top:2px; }
.btn.ghost:hover { background:#F1F5F9; }
.toast { position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:50; font-size:13px; font-weight:550; padding:10px 16px; border-radius:9px; box-shadow:0 6px 20px rgba(15,23,42,.18); max-width:520px; }
.toast.ok { background:#F0FDFA; color:#0F766E; border:1px solid ${T.quick}; }
.toast.err { background:#FEF2F2; color:#B91C1C; border:1px solid ${T.accent}; }
.btn.primary { background:${T.accent}; color:#fff; border-color:${T.accent}; }
.btn.primary:hover { background:#a81919; }
.btn.danger { color:${T.accent}; border-color:${T.accent}; background:${T.accentSoft}; }
.btn[disabled] { opacity:.6; cursor:default; }
.emptycanvas { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.emptycanvas-inner { background:#fff; border:1px solid ${T.line}; border-radius:10px; padding:14px 18px; font-size:13px; color:${T.sub}; box-shadow:0 4px 14px rgba(15,23,42,.08); max-width:360px; text-align:center; line-height:1.5; }

.main { display:flex; align-items:stretch; height:660px; }
.pal { width:236px; flex-shrink:0; padding:14px; background:#fff; border-right:1px solid ${T.line}; display:flex; flex-direction:column; gap:7px; overflow:auto; }
.seclabel { font-size:11px; font-weight:650; text-transform:uppercase; letter-spacing:.07em; color:${T.faint}; margin:12px 0 3px; }
.teamrow { display:flex; align-items:center; gap:7px; }
.swatch { width:18px; height:18px; border-radius:5px; border:none; cursor:pointer; flex-shrink:0; }
.teamname { flex:1; min-width:0; font-size:12.5px; padding:5px 7px; border:1px solid ${T.line}; border-radius:6px; outline:none; color:${T.ink}; }
.teamname:focus { border-color:${T.accent}; }
.xbtn { border:none; background:none; color:${T.faint}; font-size:17px; line-height:1; cursor:pointer; padding:0 3px; }
.xbtn:hover { color:${T.accent}; }
.palbtn { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border-radius:9px; border:1px solid ${T.line}; background:#fff; cursor:pointer; text-align:left; }
.palbtn:hover { border-color:#CBD5E1; background:#F8FAFC; }
.palicon { width:24px; height:24px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.palname { font-size:12.5px; font-weight:600; }
.note { margin-top:auto; display:flex; gap:7px; font-size:11.5px; line-height:1.45; color:${T.sub}; background:#F8FAFC; border:1px solid ${T.line}; border-radius:9px; padding:10px; }

.cv { flex:1; min-width:0; background:${T.canvas}; position:relative; }
.vp { position:absolute; inset:0; overflow:auto; scrollbar-width:thin; scrollbar-color:#94A3B8 #E2E8F0; }
.vp::-webkit-scrollbar { width:12px; height:12px; }
.vp::-webkit-scrollbar-track { background:#E8EDF3; }
.vp::-webkit-scrollbar-thumb { background:#B4C0CE; border-radius:8px; border:3px solid #E8EDF3; }
.vp::-webkit-scrollbar-thumb:hover { background:#94A3B8; }
.vp::-webkit-scrollbar-corner { background:#E8EDF3; }
.world { position:relative; touch-action:none; }
.lane { position:absolute; left:0; border-bottom:1px solid; }
.lanelabel { position:absolute; left:12px; top:10px; display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:650; padding:3px 9px; border:1px solid; border-radius:20px; background:#fff; pointer-events:none; }
.lanedot { width:8px; height:8px; border-radius:50%; }
.edges { position:absolute; inset:0; pointer-events:none; }
.edges path, .edges g { pointer-events:auto; }
.cond { font-family:ui-monospace,monospace; font-size:10.5px; }

.node { position:absolute; background:#fff; border:1px solid ${T.line}; border-radius:11px; display:flex; overflow:visible; user-select:none; cursor:grab; }
.node.ext { border-style:dashed; background:#FFF7ED; }
.node:active { cursor:grabbing; }
.rail { width:5px; border-radius:11px 0 0 11px; flex-shrink:0; }
.nbody { padding:8px 11px; flex:1; min-width:0; }
.ntop { display:flex; align-items:center; justify-content:space-between; gap:6px; }
.kind { display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:650; text-transform:uppercase; letter-spacing:.05em; }
.scorechip { font-size:11px; font-weight:700; color:#fff; padding:1px 7px; border-radius:20px; font-family:ui-monospace,monospace; }
.nlabel { font-size:13.5px; font-weight:600; margin-top:4px; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.slug { font-size:11px; color:${T.sub}; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.handle { position:absolute; right:-7px; top:50%; transform:translateY(-50%); width:13px; height:13px; border-radius:50%; background:#fff; border:2px solid ${T.faint}; cursor:crosshair; }
.handle:hover { transform:translateY(-50%) scale(1.25); }

.panel { width:322px; flex-shrink:0; background:#fff; border-left:1px solid ${T.line}; display:flex; flex-direction:column; }
.tabs { display:flex; padding:8px 6px 0; gap:2px; border-bottom:1px solid ${T.line}; }
.tab { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:4px; font-size:11.5px; font-weight:600; padding:8px 3px; border:none; background:none; color:${T.sub}; cursor:pointer; border-bottom:2px solid transparent; }
.tab.on { color:${T.accent}; border-bottom-color:${T.accent}; }
.pbody { padding:14px; overflow:auto; flex:1; }

.rowhead { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.rowtitle { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
.del { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; color:${T.accent}; background:none; border:none; cursor:pointer; padding:2px 4px; border-radius:5px; }
.del:hover { background:${T.accentSoft}; }
.flow { display:flex; align-items:center; gap:6px; font-size:12px; background:#F8FAFC; border:1px solid ${T.line}; border-radius:8px; padding:8px 10px; margin-bottom:10px; }
.crosstag { font-size:11.5px; color:${T.accent}; font-weight:600; background:${T.accentSoft}; border-radius:7px; padding:7px 9px; margin-bottom:10px; }

.field { display:block; margin-bottom:11px; }
.fieldlbl { display:block; font-size:11.5px; font-weight:600; color:${T.sub}; margin-bottom:4px; }
.input { width:100%; box-sizing:border-box; font-size:13px; padding:7px 9px; border:1px solid ${T.line}; border-radius:7px; color:${T.ink}; outline:none; background:#fff; }
.input:focus { border-color:${T.accent}; }
select.input { cursor:pointer; }
.slugline { font-size:11.5px; color:${T.sub}; margin:-2px 0 12px; }
.slugline .mono { color:${T.accent}; }
.seg { display:flex; border:1px solid ${T.line}; border-radius:7px; overflow:hidden; }
.segbtn { flex:1; font-size:12px; font-weight:600; padding:7px; border:none; background:#fff; color:${T.sub}; cursor:pointer; }
.segbtn.on { background:${T.accent}; color:#fff; }

.slider { margin-bottom:12px; }
.sliderhead { display:flex; justify-content:space-between; font-size:12px; margin-bottom:3px; }
.sliderval { color:${T.accent}; font-weight:700; }
.slider input[type=range] { width:100%; accent-color:${T.accent}; }
.sliderends { display:flex; justify-content:space-between; font-size:10px; color:${T.faint}; }
.scorebox { display:flex; align-items:center; justify-content:space-between; background:#F8FAFC; border:1px solid ${T.line}; border-radius:10px; padding:12px 14px; margin-top:6px; }
.scorebig { font-size:26px; font-weight:750; line-height:1; }
.scorelbl { font-size:10.5px; color:${T.faint}; text-transform:uppercase; letter-spacing:.06em; margin-top:3px; }
.reusetoggle { display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:9px 11px; margin:2px 0 10px; border:1px solid ${T.line}; border-radius:9px; background:#fff; cursor:pointer; }
.reusetoggle.on { border-color:${T.quick}; background:#F0FDFA; }
.reuseswitch { flex-shrink:0; width:34px; height:20px; border-radius:20px; background:#CBD5E1; position:relative; transition:background .15s; }
.reusetoggle.on .reuseswitch { background:${T.quick}; }
.reuseknob { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:left .15s; box-shadow:0 1px 2px rgba(0,0,0,.2); }
.reusetoggle.on .reuseknob { left:16px; }
.reusetext { display:flex; flex-direction:column; gap:1px; }
.reusetitle { display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:${T.ink}; }
.reusehint { font-size:11px; color:${T.sub}; }
.reuseflag { display:inline-flex; align-items:center; gap:3px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:${T.quick}; border:1px solid ${T.quick}; border-radius:20px; padding:1px 6px; }
.mbpmgrid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:2px 0 4px; }
.mfield { display:block; }
.mlbl { display:block; font-size:11px; color:${T.sub}; margin-bottom:3px; line-height:1.2; min-height:26px; }
.minputwrap { display:flex; align-items:stretch; border:1px solid ${T.line}; border-radius:7px; overflow:hidden; }
.minputwrap:focus-within { border-color:${T.accent}; }
.minput { flex:1; min-width:0; width:100%; box-sizing:border-box; border:none; outline:none; font-size:13px; padding:6px 8px; color:${T.ink}; background:#fff; }
.munit { font-size:10px; color:${T.faint}; padding:0 7px; background:#F8FAFC; display:flex; align-items:center; }
.mstat { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:2px 0 6px; }
.mstat > div { background:#F8FAFC; border:1px solid ${T.line}; border-radius:9px; padding:11px 12px; }
.mstatbig { font-size:23px; font-weight:750; line-height:1; color:${T.ink}; }
.munitbig { font-size:11px; font-weight:600; color:${T.faint}; margin-left:3px; }
.mstatlbl { font-size:10px; color:${T.faint}; text-transform:uppercase; letter-spacing:.05em; margin-top:4px; }
.mrow { display:flex; align-items:center; gap:9px; padding:7px 0; border-bottom:1px solid #F1F5F9; }
.mrowlabel { flex:1; min-width:0; font-size:12.5px; color:${T.ink}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mrowval { font-family:ui-monospace,monospace; font-size:10.5px; color:${T.sub}; }
.reusechecks { margin:-6px 0 10px; padding:10px 11px; border:1px solid ${T.line}; border-top:none; border-radius:0 0 9px 9px; background:#F8FAFC; }
.reusecheck { display:flex; align-items:flex-start; gap:8px; font-size:12px; color:${T.ink}; margin-bottom:8px; cursor:pointer; line-height:1.35; }
.reusecheck input { margin-top:1px; accent-color:${T.quick}; width:15px; height:15px; flex-shrink:0; }
.reusestatus { font-size:11px; font-weight:650; border-radius:6px; padding:6px 8px; }
.reusestatus.ok { color:${T.quick}; background:#F0FDFA; border:1px solid ${T.quick}; }
.reusestatus.pending { color:${T.plan}; background:#FFFBEB; border:1px solid ${T.plan}; }

.help { font-size:11.5px; line-height:1.5; color:${T.sub}; margin:6px 0 12px; }
.blrow { display:flex; gap:10px; align-items:flex-start; padding:10px 0; border-bottom:1px solid #F1F5F9; }
.blrank { width:20px; height:20px; border-radius:6px; background:#F1F5F9; color:${T.sub}; font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }
.bltop { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.bllabel { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.blband { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; border:1px solid; border-radius:20px; padding:1px 7px; flex-shrink:0; }
.blbar { height:5px; border-radius:20px; background:#F1F5F9; margin:5px 0 4px; overflow:hidden; }
.blbar span { display:block; height:100%; border-radius:20px; }
.blmeta { display:flex; align-items:center; gap:7px; }
.teamtag { font-size:10px; font-weight:650; border:1px solid; border-radius:20px; padding:1px 7px; }
.hoflag { font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:${T.accent}; background:${T.accentSoft}; border-radius:20px; padding:1px 6px; }
.hostat { display:flex; gap:8px; margin:2px 0 4px; }
.hostat > div { flex:1; background:#F8FAFC; border:1px solid ${T.line}; border-radius:9px; padding:10px; text-align:center; }
.hostatbig { font-size:22px; font-weight:750; }
.hostatlbl { font-size:10px; color:${T.faint}; text-transform:uppercase; letter-spacing:.05em; margin-top:2px; }
.horow { display:flex; align-items:center; gap:7px; padding:8px 0; border-bottom:1px solid #F1F5F9; }
.hotype { font-size:10.5px; color:${T.sub}; margin-left:auto; background:#F1F5F9; border-radius:5px; padding:1px 6px; }
.exrow { display:flex; align-items:center; gap:7px; padding:7px 0; border-bottom:1px solid #F1F5F9; }
.exphead { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.code { background:#0F172A; color:#E2E8F0; font-size:11px; line-height:1.55; padding:12px; border-radius:9px; overflow:auto; max-height:230px; white-space:pre; margin:0; }
.empty { font-size:12.5px; color:${T.faint}; text-align:center; padding:26px 12px; line-height:1.5; }

@media (max-width: 940px) {
  .main { flex-direction:column; height:auto; }
  .pal { width:auto; border-right:none; border-bottom:1px solid ${T.line}; }
  .cv { height:460px; }
  .panel { width:auto; border-left:none; border-top:1px solid ${T.line}; }
}
`;

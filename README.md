# Automation Discovery Canvas

A browser-based tool for mapping a **cross-team manual process**, scoring each step
for automation suitability, and exporting an **AAP-ready workflow spec** (YAML +
JSON Schema) plus a shareable diagram (PDF / SVG).

It is the human, workshop-facing front end of a Spec-Driven Development (SDD)
Ansible pipeline: brainstorm the process visually here, then let a downstream
agent analyse the exported spec for completeness and generate content.

> Full usage guide: see **[instruction.md](./instruction.md)**.

## What it does

- **Swimlanes** — one lane per team; drag a step between lanes to change who owns it.
- **Node types** — Step/Role, Approval gate, Decision, External dependency, Trigger, Terminus.
- **Typed dependencies** — `sequence` (runs after), `data` (needs a named artifact), and external.
- **Suitability scoring** — frequency, standardisation, error-proneness, effort, banded into Quick win / Plan / Defer, with a *verified* reusability promotion.
- **Process metrics (MBPM)** — per-step process/lead time, %C&A and resources, rolled up into activity ratio and rolled %C&A (Metrics-Based Process Mapping baseline).
- **Handoff analysis** — every arrow that crosses a lane is counted as a cross-team handoff.
- **Export / import** — export the AAP workflow spec (YAML), JSON Schema, and a PDF or SVG of the diagram; re-import a spec to keep editing it.
- **Worked examples** — EC2-hosted website vs S3 + CloudFront (switch in the header).

## Tech stack

React 18 + Vite. **No backend, no database, no API keys** — the app is entirely
client-side and holds its state in memory. That makes hosting trivial: the build
output is just static files.

## Prerequisites

- Node.js 18+ and npm — check with `node -v`
  (macOS: `brew install node`; or download from https://nodejs.org)

## Run locally

```bash
npm install
npm run dev        # serves at http://localhost:5173 (opens automatically)
```

Production build:

```bash
npm run build      # writes static files to ./dist
npm run preview    # serve the production build locally to sanity-check it
```

Everything the browser needs ends up in `dist/`. Deployment is just "serve `dist/`".

## Deploy to AWS

Because the app is a static single-page app, you only need static hosting — there
is no server process, port, or secret to manage. The two common patterns below
happen to mirror the two examples the tool itself ships with.

### Option A — S3 + CloudFront (recommended)

Cheapest, fastest, globally cached. Keep the bucket **private** and serve it
through CloudFront with Origin Access Control (OAC).

```bash
# 1. Build
npm run build

# 2. Create a private bucket and upload the build
aws s3 mb s3://<your-bucket-name> --region <region>
aws s3 sync dist/ s3://<your-bucket-name> --delete

# 3. Create a CloudFront distribution (console is easiest) with:
#      Origin            : <your-bucket-name>.s3.<region>.amazonaws.com  (S3 origin + OAC)
#      Default root object: index.html
#      Viewer protocol    : Redirect HTTP to HTTPS
#    OAC auto-generates the bucket policy that lets only CloudFront read the bucket.

# 4. On every redeploy: re-sync and invalidate the cache
aws s3 sync dist/ s3://<your-bucket-name> --delete
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/*"
```

This app has a single view (no client-side router), so no SPA 404-rewrite is
required. If you later add routing, add a CloudFront custom error response
mapping 403 and 404 to `/index.html` with HTTP 200.

> Ansible-native alternative: the same steps express cleanly as a play using
> `amazon.aws.s3_bucket`, `amazon.aws.s3_object`, and
> `community.aws.cloudfront_distribution` / `cloudfront_invalidation` — a good
> candidate to dogfood through the canvas itself.

### Option B — EC2 + nginx

Use when the site must live inside a specific VPC/subnet or alongside other
workloads on the instance.

```bash
# Launch an instance (Amazon Linux 2023 or Ubuntu); security group inbound 80 (and 443 for TLS).

# Build locally and copy dist/ up, OR build on the box:
#   Amazon Linux 2023:  sudo dnf install -y nodejs
#   Ubuntu:             sudo apt update && sudo apt install -y nodejs npm
#   npm ci && npm run build

# Install nginx and publish the build
sudo dnf install -y nginx            # Ubuntu: sudo apt install -y nginx
sudo rm -rf /usr/share/nginx/html/*
sudo cp -r dist/* /usr/share/nginx/html/
sudo systemctl enable --now nginx
```

Minimal server block (`/etc/nginx/conf.d/discovery.conf`):

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

For HTTPS, terminate TLS at an Application Load Balancer, or install a certificate
on the box with certbot.

## Project structure

```
ansible-discovery/
  index.html          # Vite entry HTML
  vite.config.js      # Vite + React plugin config
  package.json        # scripts: dev / build / preview
  src/
    main.jsx          # React entry point
    App.jsx           # the entire tool (single component)
    index.css         # minimal reset so the canvas fills the viewport
  README.md           # this file
  instruction.md      # how to use the tool
```

The whole application lives in `src/App.jsx`. The two things you are most likely
to edit are the scoring weights (the `scoreOf` function near the top) and the
worked examples (the `seed` function).

## Notes

- No data leaves the browser; there is nothing to secure server-side.
- State is in memory only — a refresh clears the canvas. Use the **PDF/SVG** and
  **YAML** exports to persist a session.

# AGENTS.md — Company Dossier (VS Code extension)

Guidance for AI coding agents working in this repository.

## What this is
A VS Code extension that builds a structured, multi-section **company dossier** from public
data. The user enters a company URL/name; the extension collects public signals and writes a
navigable Markdown dossier into the workspace. Public sources only.

## Sibling projects
- Methodology + website + npm package + AI integrations: https://github.com/ever-just/company-dossier
- npm package (CLI + library + MCP server): `company-dossier` — `npx company-dossier <company>`
- Website / docs: https://companydossier.lol

## Layout
- `src/extension.ts` — activation, command/chat/sidebar registration, wiring.
- `src/sidebar/provider.ts` — the webview sidebar (input UI, progress).
- `src/agent.ts` — the `runResearch` orchestrator and optional Claude synthesis.
- `src/types.ts` — shared pipeline contract (`ResearchInput`, `ResearchResult`, etc.).
- `src/collectors/` — independent, side-effect-light data collectors:
  `website.ts` (crawl), `wayback.ts` (history), `dns.ts` (DNS/email recon),
  `techstack.ts` (tech detection), `search.ts` (public search).
- `src/generators/` — turn collected data into files: `scaffold.ts` (folder structure),
  `router.ts` (ROUTER/index), `corporate.ts` (section rendering).
- `src/utils.ts` — shared helpers (fetch, fs, slugify, dates).

## Build / run
- Install: `npm install`
- Compile: `npm run compile` (tsc → `out/`)
- Debug: open in VS Code, press F5 (Extension Development Host).

## Output contract
A dossier is a folder of Markdown files organized into 12 numbered sections
(corporate, people, products, suppliers, customers, competitors, financials,
marketing, brand, timeline, analysis, industry), plus `README.md`, a `ROUTER.md`
question→file index, and `_meta`/`_data`/`_assets`/`_evidence` support folders.
Every file carries YAML frontmatter; every derived claim should be source-attributed.

## Conventions for changes
- Keep collectors free of UI/VS Code coupling where possible (mirrors the npm package core).
- No private-data scraping, no auth bypass — public sources only.
- Don't commit secrets; API keys come from VS Code settings / env at runtime.
- Run `npm run compile` before opening a PR.

# Company Dossier — Intelligence Research

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/EVERJUSTs.company-dossier?label=VS%20Code%20Marketplace&color=0d1117)](https://marketplace.visualstudio.com/items?itemName=EVERJUSTs.company-dossier)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/EVERJUSTs.company-dossier?color=0d1117)](https://marketplace.visualstudio.com/items?itemName=EVERJUSTs.company-dossier)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Turn any company URL into a structured competitive-intelligence dossier — without leaving VS Code. Company Dossier crawls the live site, reconstructs its history from the Wayback Machine, fingerprints DNS/email infrastructure and the tech stack, pulls public records, and (optionally) uses Claude to synthesize an executive brief, SWOT, and key findings into a navigable, agent-friendly folder of markdown.

## Features

- **One-input research** — give a company name + URL, get a complete dossier.
- **Live website crawl** — homepage, sitemap, and up to 50 prioritized pages (about, team, products, pricing, contact, news).
- **Wayback history** — multi-query CDX recon: total captures, unique URLs, archived PDFs, and deleted pages.
- **DNS & email recon** — MX provider, SPF, DMARC, subdomains, verification tokens.
- **Tech-stack detection** — CMS, frameworks, CDN, analytics IDs, GTM, and ad pixels.
- **Public records** — USASpending federal contracts and discovered social profiles.
- **AI synthesis (optional)** — executive brief, SWOT, ranked findings, and "manual research needed", grounded in collected evidence (requires an Anthropic API key).
- **Structured output** — a 12-section dossier with YAML frontmatter, `_MOC.md` maps of content, and a `ROUTER.md` so AI agents can navigate in two reads.
- **Public data only** — no logins, no scraping behind authentication.

## Install

**From the Marketplace**

1. Open VS Code → Extensions (`Ctrl/Cmd+Shift+X`).
2. Search for **Company Dossier — Intelligence Research**.
3. Click **Install**. Or [open it on the Marketplace](https://marketplace.visualstudio.com/items?itemName=EVERJUSTs.company-dossier).

**From source**

```bash
git clone https://github.com/ever-just/company-dossier-vscode
cd company-dossier-vscode
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host, or package a `.vsix` with `npx vsce package` and install it via Extensions → "Install from VSIX…".

## Usage

Open a folder in VS Code first — dossiers are written into the open workspace.

- **Sidebar view** — click the Company Dossier icon in the Activity Bar, enter a company name + URL, and run the research pipeline with live progress.
- **Chat participant** — in the Chat view (Copilot Chat), type:
  ```
  @dossier /research Acme Corp https://acme.com
  ```
  Results stream back inline with a button to open the generated dossier.
- **Command Palette** (`Ctrl/Cmd+Shift+P`):
  - **Dossier: Research Company** — prompts for name + URL, then runs the full pipeline.
  - **Dossier: New Entity Profile** — scaffolds a profile (person, supplier, competitor, client, product) into the right section.

**Optional AI synthesis:** add your key in Settings → **Company Dossier → Anthropic API Key** (`companyDossier.anthropicApiKey`). Without a key, data is still collected and written; only the LLM synthesis step is skipped. Tune crawl depth with `companyDossier.maxPages`.

## Output

Each run creates a `"<Company> DOSSIER/"` folder in your workspace:

```
<Company> DOSSIER/
├── README.md              ← Landing page
├── ROUTER.md              ← AI-agent navigation (question → file)
├── CHANGELOG.md
├── _meta/                 ← Methodology, confidence scale
├── _data/                 ← Structured data (CSVs)
├── _assets/               ← Photos & PDFs
├── _evidence/             ← Raw source data
├── 1_corporate/           ← Identity, legal, certifications
├── 2_people/profiles/     ← One file per person
├── 3_products/            ← Products, services, pricing
├── 4_suppliers/profiles/  ← One file per supplier
├── 5_customers/           ← Clients, prospects
├── 6_competitors/profiles/← One file per competitor
├── 7_financials/          ← Revenue, valuation
├── 8_marketing/           ← Social, events, press
├── 9_brand/               ← Visual identity
├── 10_timeline/           ← History, milestones
├── 11_analysis/           ← Risk register, SWOT, theses
└── 12_industry/           ← Market context
```

Every file carries YAML frontmatter (type, confidence, last-updated). With an API key, the analysis section is populated with an executive brief, SWOT, key findings, and a manual-research checklist.

## Also available as

Company Dossier is part of a larger ecosystem:

- **Website** — [companydossier.lol](https://companydossier.lol)
- **npm package** — [`company-dossier`](https://www.npmjs.com/package/company-dossier) — run it from the terminal:
  ```bash
  npx company-dossier <company>
  ```
- **Core repo & methodology** — [github.com/ever-just/company-dossier](https://github.com/ever-just/company-dossier)

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — the collector → generator → sidebar flow.
- [AGENTS.md](./AGENTS.md) — how an AI agent should understand and extend this repo.
- [Contributing](./CONTRIBUTING.md) · [Code of Conduct](./CODE_OF_CONDUCT.md) · [Security](./SECURITY.md) · [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE) © EverJust

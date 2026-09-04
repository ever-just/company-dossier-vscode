# Company Dossier for VS Code

Company research and competitive intelligence inside your editor — a sourced dossier without leaving the workspace.

**Status:** Production · v1.2.0 on the Marketplace · public · MIT

[![marketplace](https://img.shields.io/visual-studio-marketplace/v/EVERJUSTs.company-dossier?style=flat&color=1D1D1F&label=marketplace)](https://marketplace.visualstudio.com/items?itemName=EVERJUSTs.company-dossier)
[![license](https://img.shields.io/badge/license-MIT-1D1D1F?style=flat)](LICENSE)

[Install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=EVERJUSTs.company-dossier) ·
[Product site](https://companydossier.lol) ·
[Core repo and methodology](https://github.com/ever-just/company-dossier) ·
[Architecture](docs/ARCHITECTURE.md)

|  |  |
|---|---|
| **What it is** | A VS Code extension that turns a company name and URL into a 12-section markdown dossier |
| **Who it's for** | Developers, founders and analysts who already live in the editor |
| **Live at** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=EVERJUSTs.company-dossier) · [companydossier.lol](https://companydossier.lol) |
| **Stack** | TypeScript · VS Code Extension API ≥1.93 · Anthropic SDK (optional) · no backend |
| **Status** | Production · v1.2.0 · free · public sources only |

## The problem it solves

Company research happens in a browser and lands in a document nobody opens again. You lose the
context of the work you were actually doing, and the output is a wall of prose with no structure
an editor, a diff, or an AI agent can use.

This extension keeps the research where the work is. Type a company name and a URL into the
sidebar, or ask the chat participant, and it crawls the live site, reconstructs the site's
history from the Wayback Machine, fingerprints DNS and the tech stack, pulls public records, and
writes a navigable folder of Markdown straight into your workspace — versioned with everything
else, greppable, and readable by the agents already in your editor. Public sources only, no
login, no scraping behind authentication.

## What it does

- **One input, whole pipeline** — a company name plus a URL runs all seven phases.
- **Crawls the live site** — homepage, sitemap, and up to 50 prioritised pages (about, team,
  products, pricing, contact, news).
- **Reconstructs history** — multi-query Wayback CDX recon: total captures, unique URLs,
  archived PDFs, and pages that were deleted.
- **Fingerprints infrastructure** — MX provider, SPF, DMARC, subdomains, verification tokens,
  CMS, frameworks, CDN, analytics IDs, GTM and ad pixels.
- **Synthesises with Claude, optionally** — executive brief, SWOT, ranked findings, and a
  "manual research needed" checklist, grounded in the collected evidence. Skipped without a key;
  collection still runs.
- **Writes for agents as well as people** — YAML frontmatter on every file, `_MOC.md` maps of
  content, and a `ROUTER.md` so an agent answers a question in two reads.

## Quickstart

Install from the Marketplace, open a folder (dossiers are written into the open workspace), then
use the sidebar, the chat participant, or the Command Palette:

```
@dossier /research Acme Corp https://acme.com
```

To run it from source:

```bash
git clone https://github.com/ever-just/company-dossier-vscode && cd company-dossier-vscode
npm install && npm run compile     # then press F5 for an Extension Development Host
npx vsce package                   # or build a .vsix to install manually
```

## How it works

`agent.ts` is the orchestrator. Both entry points — the sidebar webview and the chat participant
— hand it a `ResearchInput`, it fans out to the collectors in parallel, optionally passes the
collected evidence to Claude for synthesis, then drives the generators that write the folder
tree, the content files and the router index. Collectors never write; generators never fetch.
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) has the full diagram.

### Repository layout

```
src/extension.ts        Activation, commands, chat participant registration
src/agent.ts            Orchestrator — runs the seven research phases
src/sidebar/            Webview provider: the input form and live progress
src/collectors/         website · wayback · dns · techstack · search (read-only)
src/generators/         scaffold (folder tree + _MOC) · corporate · router (ROUTER.md)
src/types.ts            Shared types across collectors and generators
snippets/               Markdown frontmatter snippets for hand-written dossier files
docs/ARCHITECTURE.md    Collector → generator flow and pipeline phases
```

## Configuration

| Setting | Required | Default | Purpose |
|---|---|---|---|
| `companyDossier.anthropicApiKey` | No | empty | Enables the LLM synthesis step; without it, data is still collected and written |
| `companyDossier.maxPages` | No | `50` | Maximum pages crawled from the target's sitemap |

The key is read from your VS Code settings and used only to call Anthropic from your machine.
Nothing is sent anywhere else — the extension has no backend.

## Related

The same research engine ships as a website, a CLI, a library and an MCP server in
[ever-just/company-dossier](https://github.com/ever-just/company-dossier) — `npx company-dossier
acme.com` produces the terminal equivalent of this extension's output.

## License

[MIT](LICENSE) · by EVERJUST. Public information only — a dossier is a starting map, not a
verdict. [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

# Architecture

Company Dossier is a VS Code extension that turns a company name + URL into a
structured, multi-section markdown dossier. The pipeline is organized as a
**collector → generator** flow, driven by two **entry points** (sidebar webview
and chat participant), with `agent.ts` as the orchestrator.

```
                ┌─────────────────────────────────────────────┐
  Entry points  │  sidebar/provider.ts   extension.ts (chat /  │
                │  (webview UI)          command palette)      │
                └───────────────┬─────────────────────────────┘
                                │ ResearchInput { companyName, url, depth, apiKey }
                                ▼
                        ┌───────────────┐
                        │   agent.ts    │   runResearch() — orchestrator
                        │ (7 phases)    │
                        └───────┬───────┘
                                │
          ┌──────────── COLLECTORS (parallel) ────────────┐
          │  collectors/website.ts   → WebsiteData         │
          │  collectors/wayback.ts   → WaybackData         │
          │  collectors/dns.ts       → DnsData             │
          │  collectors/techstack.ts → TechStackData       │
          │  collectors/search.ts    → SearchData          │
          └───────────────────────┬───────────────────────┘
                                   │  (+ optional Claude LLM synthesis)
                                   ▼
          ┌──────────── GENERATORS (write files) ──────────┐
          │  generators/scaffold.ts  → folder tree + _MOC  │
          │  generators/corporate.ts → content markdown    │
          │  generators/router.ts    → ROUTER.md index     │
          └───────────────────────┬───────────────────────┘
                                   ▼
                     "<Company> DOSSIER/" on disk
```

## Layout

| Path | Responsibility |
|------|----------------|
| `src/extension.ts` | Activation. Registers the sidebar provider, chat participant (`@dossier /research`), and commands (`companyDossier.research`, `companyDossier.newEntity`). |
| `src/sidebar/provider.ts` | Webview UI entry point. Collects input and calls `runResearch`, streaming progress back to the panel. |
| `src/agent.ts` | Orchestrator. Defines the shared research types (`ResearchInput`, `ResearchResult`, `LLMSynthesis`, etc.), runs the 7-phase pipeline, and performs optional Claude synthesis. |
| `src/collectors/*` | Pure data collection from **public** sources. Each module exports a typed `*Data` interface and a `collect*`/`extract*` function. No file writes. |
| `src/generators/*` | Turn collected data into files on disk. Each exports a `generate*`/`scaffold*` function. No network calls. |
| `src/utils.ts` | Shared helpers: `fetchText`, `fetchJSON`, `mkdirp`, `writeFile`, `slugify`, `todayISO`, `sleep`. |
| `snippets/frontmatter.json` | Markdown snippets for dossier frontmatter. |
| `assets/` | Non-shipping icon source variants. The shipping icon is `icon.png` at the repo root. |

## Pipeline (agent.ts → runResearch)

1. **Scaffold** — `scaffoldDossier` creates the 12-section folder tree, `_MOC.md` maps, `_meta/`, and `CHANGELOG.md`.
2. **Parallel collection** — website crawl, Wayback CDX, DNS recon, and public search run concurrently (`Promise.all`). The deep crawl (up to `maxPages`) runs inside the website stream because it depends on the sitemap.
3. **Wait** for all streams.
4. **Tech stack** — `extractTechStack` runs over the combined crawled HTML; discovered social links enrich `SearchData`.
5. **LLM synthesis (optional)** — if an Anthropic API key is set, all collected data is sent to Claude to produce executive brief, SWOT, key findings, and a manual-research checklist.
6. **Generate files** — `generateCorporateFiles` writes content markdown from the collected + synthesized data.
7. **ROUTER.md** — `generateRouter` builds the question → file navigation index.

## Design rules

- **Collectors never write files; generators never make network calls.** This keeps each side testable and the data contract explicit.
- **Public data only.** No authentication, no scraping behind logins.
- **Graceful degradation.** Every collector is wrapped so a single failure becomes a warning in `ResearchResult.errors` rather than aborting the run. AI synthesis is fully optional.
- **Agent-friendly output.** Frontmatter + `ROUTER.md` let downstream AI agents locate facts in ~2 reads.

See [AGENTS.md](../AGENTS.md) for how to extend collectors/generators and the dossier output contract.

# Company Dossier

Build structured competitive intelligence dossiers on private companies — right from VS Code.

## Features

### Scaffold a Complete Dossier Structure
`Ctrl+Shift+P` → **Dossier: Create New Dossier Structure**

Creates the full 12-section dossier folder tree with:
- 30+ directories organized by intelligence category
- README.md with navigation table
- ROUTER.md skeleton (question-to-file lookup for AI agents)
- _MOC.md (Map of Content) for each section
- _data/README.md for CSV schema documentation
- _meta/ files (methodology, confidence legend)
- CHANGELOG.md

### Create Entity Profiles
`Ctrl+Shift+P` → **Dossier: New Entity Profile**

Generate pre-formatted markdown files for:
- **People** (CEO, team members) → `2_people/profiles/`
- **Suppliers** (manufacturer partners) → `4_suppliers/profiles/`
- **Competitors** → `6_competitors/profiles/`
- **Clients** → `5_customers/`
- **Products** → `3_products/`

Each profile includes YAML frontmatter with entity type, confidence level, and related files.

### Add YAML Frontmatter
`Ctrl+Shift+P` → **Dossier: Add YAML Frontmatter to Current File**

Adds structured metadata to any markdown file. Choose from 5 types:
- `reference` — facts, registrations, contacts
- `analysis` — judgments, assessments, theses
- `entity-profile` — person, supplier, competitor, client
- `evidence` — raw data, source material
- `moc` — Map of Content navigation file

### Generate ROUTER.md
`Ctrl+Shift+P` → **Dossier: Generate ROUTER.md from Files**

Automatically scans your dossier and generates a question-to-file lookup table. Maps natural-language questions to exact file paths so AI agents can navigate in 2 reads.

### Snippets

Type these prefixes in any markdown file:

| Prefix | What it inserts |
|--------|----------------|
| `dossier-entity` | Full entity profile frontmatter + template |
| `dossier-ref` | Reference document frontmatter |
| `dossier-analysis` | Analysis document frontmatter |
| `dossier-evidence` | Evidence document frontmatter |
| `dossier-moc` | Map of Content template |
| `conf-` | Inline confidence tag `[Confidence: High]` |
| `dossier-finding` | Intelligence finding table row |

## The Dossier Structure

```
COMPANY DOSSIER/
├── README.md              ← Landing page
├── ROUTER.md              ← AI agent navigation (question → file)
├── CHANGELOG.md
├── _meta/                 ← Methodology, confidence scale
├── _data/                 ← All CSVs (single source of truth)
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

## Methodology

This extension implements the [Company Dossier methodology](https://github.com/ever-just/company-dossier) — a 7-phase research pipeline for building intelligence packages using AI agents and OSINT tools.

## Requirements

- VS Code 1.85+
- No other dependencies

## License

MIT

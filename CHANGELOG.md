# Changelog

All notable changes to the Company Dossier VS Code extension are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]
- Repo housekeeping: extracted the shared pipeline contract into `src/types.ts`
  (decoupling generators from the orchestrator), tidied docs, and tightened
  `.vscodeignore`. No change to runtime behavior.

## [1.2.0]
- Parallel collection with dependency-aware execution order (faster dossiers).

## [1.1.0]
- Deep agentic research: 9-phase pipeline with LLM synthesis.

## [1.0.0]
- Initial release: full agentic research tool — sidebar + chat participant (`@dossier /research`)
  + automatic collection (website crawl, Wayback history, DNS recon, tech-stack detection).

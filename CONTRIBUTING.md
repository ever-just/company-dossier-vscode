# Contributing to Company Dossier

Thanks for your interest in improving Company Dossier! This guide covers how to
set up the project, the codebase layout, and how to propose changes.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Prerequisites

- Node.js 18+ (the extension targets the Node runtime bundled with VS Code 1.93+)
- VS Code 1.93 or newer

## Getting started

```bash
git clone https://github.com/ever-just/company-dossier-vscode
cd company-dossier-vscode
npm install
npm run compile      # one-off TypeScript build → out/
npm run watch        # rebuild on change while developing
```

Press `F5` in VS Code to launch an **Extension Development Host** with the
extension loaded. Open a folder in that window, then use the sidebar, the
`@dossier /research` chat participant, or the **Dossier: Research Company**
command.

To package a `.vsix`:

```bash
npx vsce package
```

## Project layout

| Path | What lives here |
|------|-----------------|
| `src/extension.ts` | Activation, command/chat/sidebar registration |
| `src/agent.ts` | Orchestrator (`runResearch`) + optional LLM synthesis |
| `src/types.ts` | Shared pipeline types (`ResearchInput`, `ResearchResult`, …) |
| `src/collectors/` | Public-data collectors (website, wayback, dns, techstack, search) |
| `src/generators/` | File generators (scaffold, corporate, router) |
| `src/utils.ts` | Shared helpers (fetch, fs, slugify, dates) |
| `docs/ARCHITECTURE.md` | The collector → generator → sidebar flow |
| `AGENTS.md` | Guide for AI agents extending the repo |

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) before making structural changes.

## Adding a collector

1. Create `src/collectors/<name>.ts` that exports a typed `*Data` interface and an
   async `collect*` function. **Collectors must only read public data and must not
   write files.**
2. Wrap failures so they surface as warnings (push to `errors`) rather than throwing.
3. Wire it into the parallel collection block in `src/agent.ts` and add its result
   to `ResearchResult` in `src/types.ts`.
4. Feed the new data into `generators/corporate.ts` and, if relevant, the LLM
   synthesis context.

## Adding a generator

Generators in `src/generators/` turn collected data into files. They must not make
network calls — use `utils.writeFile` / `writeIfNotExists` to write under the
dossier directory.

## Pull requests

1. Branch from `main`.
2. Keep changes focused; update docs (`README.md`, `docs/`, `AGENTS.md`) when behavior changes.
3. Run `npm run compile` and confirm it builds with no errors.
4. Add an entry to [CHANGELOG.md](./CHANGELOG.md) under an "Unreleased" heading.
5. Open a PR using the template and describe what changed and how you tested it.

## Reporting bugs & requesting features

Use the GitHub [issue templates](https://github.com/ever-just/company-dossier-vscode/issues/new/choose).
For security issues, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

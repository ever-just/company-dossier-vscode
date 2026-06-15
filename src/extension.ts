import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const DOSSIER_SECTIONS = [
  { dir: '_meta', desc: 'Navigation infrastructure' },
  { dir: '_data', desc: 'All structured data (CSVs)' },
  { dir: '_assets/photos/people', desc: 'Personnel photos' },
  { dir: '_assets/photos/products', desc: 'Product photos' },
  { dir: '_assets/photos/facilities', desc: 'Facility photos' },
  { dir: '_assets/photos/events', desc: 'Event photos' },
  { dir: '_assets/photos/brand', desc: 'Brand assets' },
  { dir: '_assets/photos/logos', desc: 'Partner logos' },
  { dir: '_assets/pdfs/datasheets', desc: 'Product datasheets' },
  { dir: '_assets/pdfs/job_postings', desc: 'Job posting archives' },
  { dir: '_evidence/source_data', desc: 'LinkedIn, MN SOS, media extractions' },
  { dir: '_evidence/bulk_datasets', desc: 'D&B, S&P Global exports' },
  { dir: '_evidence/web_scrapes/raw_html', desc: 'Wayback HTML captures' },
  { dir: '_archive', desc: 'Superseded files' },
  { dir: '1_corporate', desc: 'Identity, registrations, certifications' },
  { dir: '2_people/profiles', desc: 'Individual person profiles' },
  { dir: '3_products/categories', desc: 'Product category breakdowns' },
  { dir: '4_suppliers/profiles', desc: 'Individual supplier profiles' },
  { dir: '5_customers/prospects', desc: 'Prospect lists' },
  { dir: '6_competitors/profiles', desc: 'Individual competitor profiles' },
  { dir: '7_financials', desc: 'Revenue, signals, valuation' },
  { dir: '8_marketing/events', desc: 'Event details' },
  { dir: '9_brand', desc: 'Visual identity, name origin' },
  { dir: '10_timeline', desc: 'Founding story, chronology' },
  { dir: '11_analysis', desc: 'Risk register, theses, SWOT' },
  { dir: '12_industry/history', desc: 'Industry timeline' },
  { dir: '12_industry/regulation', desc: 'Legal, licensing, tariffs' },
  { dir: '12_industry/workforce', desc: 'Labor, diversity, associations' },
  { dir: '12_industry/technology', desc: 'Cooling, edge, modular' },
  { dir: '12_industry/political', desc: 'Incentives, energy, policy' },
  { dir: '12_industry/synthesis', desc: 'Positioning, opportunities, threats' },
];

const CONTENT_SECTIONS = [
  '1_corporate', '2_people', '3_products', '4_suppliers', '5_customers',
  '6_competitors', '7_financials', '8_marketing', '9_brand', '10_timeline',
  '11_analysis', '12_industry'
];

const ENTITY_TYPES = ['person', 'supplier', 'competitor', 'client', 'product'];

const SECTION_QUESTIONS: Record<string, string[]> = {
  '1_corporate': ['What is their legal name?', 'Where are they located?', 'What certifications do they hold?'],
  '2_people': ['Who is the CEO?', 'How many employees?', 'Who has left the company?'],
  '3_products': ['What do they sell?', 'What are their prices?', 'Do they have branded products?'],
  '4_suppliers': ['Who are their suppliers?', 'Are partnerships verified?'],
  '5_customers': ['Who are their clients?', 'What markets do they target?'],
  '6_competitors': ['Who competes with them?', 'How do they compare?'],
  '7_financials': ['What is their revenue?', 'What is the company worth?'],
  '8_marketing': ['How do they market?', 'What events do they attend?'],
  '9_brand': ['What is their brand identity?', 'What does their name mean?'],
  '10_timeline': ['When were they founded?', 'What are the key milestones?'],
  '11_analysis': ['What are the top risks?', 'Should someone acquire them?'],
  '12_industry': ['How big is the market?', 'What regulations apply?'],
};

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function mkdirp(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeIfNotExists(filePath: string, content: string): boolean {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

async function scaffoldDossier(): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Open a folder first.');
    return;
  }

  const companyName = await vscode.window.showInputBox({
    prompt: 'Company name (used for folder and README)',
    placeHolder: 'e.g., Acme Corp'
  });

  if (!companyName) { return; }

  const dossierDir = path.join(root, `${companyName} DOSSIER`);

  // Create all directories
  for (const section of DOSSIER_SECTIONS) {
    mkdirp(path.join(dossierDir, section.dir));
  }

  // Create README.md
  writeIfNotExists(path.join(dossierDir, 'README.md'), `---
title: "${companyName} Intelligence Dossier"
type: reference
last_updated: ${todayISO()}
---

# ${companyName} — Intelligence Dossier

> **AI agents:** Start with [ROUTER.md](ROUTER.md) to find any answer in 2 reads.

## Navigation

| # | Section | Start reading |
|---|---------|--------------|
| 1 | [1_corporate/](1_corporate/_MOC.md) | Identity, registrations, certifications |
| 2 | [2_people/](2_people/_MOC.md) | Org structure, profiles |
| 3 | [3_products/](3_products/_MOC.md) | Products, services, pricing |
| 4 | [4_suppliers/](4_suppliers/_MOC.md) | Supplier relationships |
| 5 | [5_customers/](5_customers/_MOC.md) | Clients, prospects |
| 6 | [6_competitors/](6_competitors/_MOC.md) | Competitive landscape |
| 7 | [7_financials/](7_financials/_MOC.md) | Revenue, valuation |
| 8 | [8_marketing/](8_marketing/_MOC.md) | Marketing, events |
| 9 | [9_brand/](9_brand/_MOC.md) | Brand identity |
| 10 | [10_timeline/](10_timeline/_MOC.md) | History |
| 11 | [11_analysis/](11_analysis/_MOC.md) | Analysis, risks |
| 12 | [12_industry/](12_industry/_MOC.md) | Industry context |
`);

  // Create ROUTER.md skeleton
  writeIfNotExists(path.join(dossierDir, 'ROUTER.md'), `---
title: "Question Router"
type: reference
domain: meta
last_updated: ${todayISO()}
---

# Question Router

> **For AI agents:** Read this file first. Find the question closest to yours. Follow the file path.

| Question | File |
|----------|------|
| What is ${companyName}? | 11_analysis/executive_brief.md |
| What is their legal name? | 1_corporate/identity.md |
| Who is the CEO? | 2_people/profiles/ |
| What do they sell? | 3_products/portfolio_overview.md |
| Who are their suppliers? | 4_suppliers/_MOC.md |
| Who are their clients? | 5_customers/known_clients.md |
| Who are their competitors? | 6_competitors/_MOC.md |
| What is their revenue? | 7_financials/revenue.md |
| How do they market? | 8_marketing/_MOC.md |
| What is their brand? | 9_brand/identity.md |
| When were they founded? | 10_timeline/founding_story.md |
| What are the risks? | 11_analysis/risk_register.md |
| How big is the market? | 12_industry/market_sizing.md |
`);

  // Create _MOC.md for each content section
  for (const section of CONTENT_SECTIONS) {
    const mocPath = path.join(dossierDir, section, '_MOC.md');
    writeIfNotExists(mocPath, `---
title: "${section} — Map of Content"
type: moc
section: ${section}
last_updated: ${todayISO()}
---

# ${section.replace(/^\d+_/, '').replace(/_/g, ' ')}

| File | Description |
|------|-------------|
| | |
`);
  }

  // Create _data/README.md
  writeIfNotExists(path.join(dossierDir, '_data', 'README.md'), `---
title: "Data Layer"
type: reference
last_updated: ${todayISO()}
---

# Data Layer

All structured data (CSVs) lives here. No CSV exists anywhere else.

## Files

| File | Description | Rows |
|------|-------------|------|
| | | |
`);

  // Create _meta files
  writeIfNotExists(path.join(dossierDir, '_meta', 'methodology.md'), `---
title: "Research Methodology"
type: reference
last_updated: ${todayISO()}
---

# Research Methodology

Public sources only. No login-gated or paid data.

## Collection Phases

1. Live Site Crawl
2. Historical Reconstruction (Wayback)
3. Document Capture
4. Government & Registry
5. People & Firmographics
6. Video & Media
`);

  writeIfNotExists(path.join(dossierDir, '_meta', 'confidence_legend.md'), `---
title: "Confidence Legend"
type: reference
last_updated: ${todayISO()}
---

# Confidence Scale

| Level | Meaning |
|-------|---------|
| **Definitive** | Government record, SEC filing, court document |
| **High** | 2+ independent credible sources |
| **Moderate** | 1 credible source or strong indicator |
| **Low** | Single non-authoritative source |
| **Inferred** | Logical deduction without direct evidence |
| **Unverified** | Single aggregator, OCR, uncorroborated |
`);

  // Create CHANGELOG.md
  writeIfNotExists(path.join(dossierDir, 'CHANGELOG.md'), `---
title: "Changelog"
type: reference
last_updated: ${todayISO()}
---

# Changelog

## ${todayISO()} — Dossier Created

Initial structure scaffolded via Company Dossier VS Code extension.
`);

  vscode.window.showInformationMessage(
    `Dossier created: ${companyName} DOSSIER (${DOSSIER_SECTIONS.length} directories, README, ROUTER, MOCs)`
  );

  // Open the README
  const readmePath = path.join(dossierDir, 'README.md');
  const doc = await vscode.workspace.openTextDocument(readmePath);
  await vscode.window.showTextDocument(doc);
}

async function newEntityProfile(): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Open a folder first.');
    return;
  }

  const entityType = await vscode.window.showQuickPick(ENTITY_TYPES, {
    placeHolder: 'What type of entity?'
  });
  if (!entityType) { return; }

  const entityName = await vscode.window.showInputBox({
    prompt: `${entityType} name`,
    placeHolder: 'e.g., Eaton Corporation'
  });
  if (!entityName) { return; }

  const slug = entityName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');

  const sectionMap: Record<string, string> = {
    person: '2_people/profiles',
    supplier: '4_suppliers/profiles',
    competitor: '6_competitors/profiles',
    client: '5_customers',
    product: '3_products',
  };

  const section = sectionMap[entityType] || '11_analysis';

  // Find dossier root (look for ROUTER.md)
  let dossierRoot = root;
  const entries = fs.readdirSync(root);
  for (const entry of entries) {
    const fullPath = path.join(root, entry);
    if (fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, 'ROUTER.md'))) {
      dossierRoot = fullPath;
      break;
    }
  }

  const dirPath = path.join(dossierRoot, section);
  mkdirp(dirPath);

  const filePath = path.join(dirPath, `${slug}.md`);
  const content = `---
title: "${entityName}"
type: entity-profile
entity_type: ${entityType}
entity_id: ${slug}
confidence: moderate
last_updated: ${todayISO()}
tags: []
related_files: []
---

# ${entityName}

## Overview



## Key Facts

| Attribute | Value |
|-----------|-------|
| | |

## Evidence



## Risk & Opportunity


`;

  if (writeIfNotExists(filePath, content)) {
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Created ${entityType} profile: ${slug}.md`);
  } else {
    vscode.window.showWarningMessage(`File already exists: ${slug}.md`);
  }
}

async function addFrontmatter(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor.');
    return;
  }

  const doc = editor.document;
  const firstLine = doc.lineAt(0).text.trim();

  if (firstLine === '---') {
    vscode.window.showWarningMessage('This file already has frontmatter.');
    return;
  }

  const fileType = await vscode.window.showQuickPick(
    ['reference', 'analysis', 'entity-profile', 'evidence', 'moc'],
    { placeHolder: 'What type of file is this?' }
  );
  if (!fileType) { return; }

  const fileName = path.basename(doc.fileName, '.md');
  const title = fileName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  let frontmatter = `---\ntitle: "${title}"\ntype: ${fileType}\n`;

  if (fileType === 'entity-profile') {
    const entityType = await vscode.window.showQuickPick(ENTITY_TYPES, {
      placeHolder: 'Entity type?'
    });
    frontmatter += `entity_type: ${entityType || 'unknown'}\n`;
    frontmatter += `entity_id: ${fileName}\n`;
  }

  frontmatter += `confidence: moderate\nlast_updated: ${todayISO()}\ntags: []\n---\n\n`;

  await editor.edit(editBuilder => {
    editBuilder.insert(new vscode.Position(0, 0), frontmatter);
  });

  vscode.window.showInformationMessage(`Added ${fileType} frontmatter.`);
}

async function generateRouter(): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Open a folder first.');
    return;
  }

  // Find dossier root
  let dossierRoot = root;
  const entries = fs.readdirSync(root);
  for (const entry of entries) {
    const fullPath = path.join(root, entry);
    if (fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, 'ROUTER.md'))) {
      dossierRoot = fullPath;
      break;
    }
  }

  // Scan all .md files and build question mappings
  const lines: string[] = [
    '---',
    'title: "Question Router"',
    'type: reference',
    `last_updated: ${todayISO()}`,
    '---',
    '',
    '# Question Router',
    '',
    '> **For AI agents:** Read this file first. Find the question closest to yours.',
    '',
  ];

  for (const section of CONTENT_SECTIONS) {
    const sectionPath = path.join(dossierRoot, section);
    if (!fs.existsSync(sectionPath)) { continue; }

    const sectionName = section.replace(/^\d+_/, '').replace(/_/g, ' ');
    lines.push(`## ${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)}`);
    lines.push('');
    lines.push('| Question | File |');
    lines.push('|----------|------|');

    // Add default questions for the section
    const questions = SECTION_QUESTIONS[section] || [];
    for (const q of questions) {
      lines.push(`| ${q} | ${section}/_MOC.md |`);
    }

    // Scan for entity profiles
    const profilesDir = path.join(sectionPath, 'profiles');
    if (fs.existsSync(profilesDir)) {
      const profiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
      for (const profile of profiles) {
        const name = path.basename(profile, '.md').replace(/_/g, ' ');
        const titleCase = name.replace(/\b\w/g, c => c.toUpperCase());
        lines.push(`| Tell me about ${titleCase} | ${section}/profiles/${profile} |`);
      }
    }

    // Scan top-level files
    const topFiles = fs.readdirSync(sectionPath).filter(f => f.endsWith('.md') && f !== '_MOC.md');
    for (const file of topFiles) {
      const name = path.basename(file, '.md').replace(/_/g, ' ');
      lines.push(`| ${name}? | ${section}/${file} |`);
    }

    lines.push('');
  }

  const routerPath = path.join(dossierRoot, 'ROUTER.md');
  fs.writeFileSync(routerPath, lines.join('\n'), 'utf8');

  const doc = await vscode.workspace.openTextDocument(routerPath);
  await vscode.window.showTextDocument(doc);

  const totalLines = lines.filter(l => l.startsWith('|') && !l.startsWith('|--')).length;
  vscode.window.showInformationMessage(`ROUTER.md generated with ${totalLines} entries.`);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('companyDossier.scaffold', scaffoldDossier),
    vscode.commands.registerCommand('companyDossier.newEntity', newEntityProfile),
    vscode.commands.registerCommand('companyDossier.addFrontmatter', addFrontmatter),
    vscode.commands.registerCommand('companyDossier.generateRouter', generateRouter),
  );
}

export function deactivate(): void {}

// ---------------------------------------------------------------------------
// Dynamic dossier generator.
//
// Writes ONLY the sections the research agents actually filled — no empty
// template folders, no placeholder _MOC stubs. Folder numbering is assigned
// from whatever sections came back, in canonical order.
// ---------------------------------------------------------------------------

import * as path from 'path';
import { writeFile, todayISO, slugify } from '../utils';
import { WebsiteData } from '../collectors/website';
import { WaybackData } from '../collectors/wayback';
import { DnsData } from '../collectors/dns';
import { TechStackData } from '../collectors/techstack';
import { SearchData } from '../collectors/search';
import { LLMSynthesis } from '../llm';
import { SocialPullResult } from '../collectors/social';

interface GeneratorInput {
  website?: WebsiteData;
  wayback?: WaybackData;
  dns?: DnsData;
  tech?: TechStackData;
  search?: SearchData;
  llmSynthesis?: LLMSynthesis;
  socialData?: SocialPullResult;
  apiKeyProvided?: boolean;
  baseUrl?: string;
}

export function generateDossierFiles(dossierDir: string, companyName: string, data: GeneratorInput): number {
  let count = 0;
  const today = todayISO();
  const syn = data.llmSynthesis;

  // -- No AI synthesis: write a single honest status file, nothing else. ------
  if (!syn) {
    writeFile(path.join(dossierDir, 'README.md'), `---
title: "${companyName} — Dossier"
type: reference
last_updated: ${today}
---

# ${companyName} — Dossier

> **No dossier generated.** AI research ${data.apiKeyProvided ? 'FAILED — open *Output → Company Dossier* (or run "Dossier: Show Dev Logs") for the exact error.' : 'was skipped because no Anthropic API key is set. Add one in Settings → Company Dossier.'}

Website: ${data.baseUrl || 'n/a'}
`);
    return 1;
  }

  // -- Number the sections that actually have content. ------------------------
  const sections = syn.sections || [];
  const numbered = sections.map((s, i) => ({
    ...s,
    folder: `${i + 1}_${s.slug}`,
  }));

  // -- Per-section research files. -------------------------------------------
  for (const s of numbered) {
    writeFile(path.join(dossierDir, s.folder, 'research.md'), `---
title: "${s.title.replace(/"/g, "'")}"
type: research
domain: ${s.slug}
last_updated: ${today}
generated_by: ai-web-research
---

# ${s.title}

${s.content}

---

*AI-researched from public web sources. Verify high-stakes claims against the cited URLs.*
`);
    count++;
  }

  // -- Analysis folder (SWOT + gaps), numbered after the research sections. ---
  const analysisFolder = `${numbered.length + 1}_analysis`;
  if (syn.swotAnalysis) {
    writeFile(path.join(dossierDir, analysisFolder, 'swot.md'), `---
title: "SWOT & Risk"
type: analysis
last_updated: ${today}
---

# SWOT & Risk: ${companyName}

${syn.swotAnalysis}
`);
    count++;
  }
  if (syn.keyFindings) {
    writeFile(path.join(dossierDir, analysisFolder, 'key_findings.md'), `---
title: "Key Findings"
type: analysis
last_updated: ${today}
---

# Key Intelligence Findings: ${companyName}

${syn.keyFindings}
`);
    count++;
  }
  if (syn.riskRegister) {
    writeFile(path.join(dossierDir, analysisFolder, 'risk_register.md'), `---
title: "Risk Register"
type: analysis
last_updated: ${today}
---

# Risk Register: ${companyName}

${syn.riskRegister}
`);
    count++;
  }
  if (syn.manualResearchNeeded) {
    writeFile(path.join(dossierDir, analysisFolder, 'research_gaps.md'), `---
title: "Research Gaps"
type: analysis
last_updated: ${today}
---

# Research Gaps & Where to Look: ${companyName}

${syn.manualResearchNeeded}
`);
    count++;
  }
  if (syn.verification) {
    writeFile(path.join(dossierDir, analysisFolder, 'verification.md'), `---
title: "Independent Verification"
type: analysis
last_updated: ${today}
---

# Independent Verification: ${companyName}

> An independent fact-checker pass (separate AI instance) audited the dossier and checked cited links. Read this before relying on any high-stakes claim.

${syn.verification}
`);
    count++;
  }

  // -- Raw signals (only if we actually have them). --------------------------
  // Only the verified official handles — the HTML collector over-extracts
  // hundreds of unrelated links, so keep one canonical profile per platform.
  const rawSocials = data.search?.socialProfiles || [];
  const seenPlatform = new Set<string>();
  const socialProfiles = rawSocials
    .filter(p => p.source === 'HEAD probe' || /\b(twitter|x\.com|facebook|instagram|youtube|linkedin|tiktok|github)\b/i.test(p.url))
    .filter(p => { const k = p.platform.toLowerCase(); if (seenPlatform.has(k)) { return false; } seenPlatform.add(k); return true; })
    .slice(0, 15);
  if (socialProfiles.length > 0) {
    const csv = ['platform,url,source', ...socialProfiles.map(p => `"${p.platform}","${p.url}","${p.source}"`)];
    writeFile(path.join(dossierDir, '_data', 'social_profiles.csv'), csv.join('\n'));
    count++;
  }
  const infraBits: string[] = [];
  if (data.dns && !data.dns.error) {
    infraBits.push(`- Email provider: ${data.dns.emailProvider}`);
    if (data.dns.mxRecords?.length) { infraBits.push(`- MX: ${data.dns.mxRecords.map(m => m.exchange).join(', ')}`); }
    if (data.dns.subdomains?.length) { infraBits.push(`- Subdomains: ${data.dns.subdomains.join(', ')}`); }
  }
  if (data.tech && data.tech.cms && data.tech.cms !== 'Unknown') { infraBits.push(`- CMS: ${data.tech.cms}`); }
  if (data.wayback && !data.wayback.error && data.wayback.firstCapture) {
    infraBits.push(`- Wayback first seen: ${data.wayback.firstCapture}; captures: ${data.wayback.totalCaptures}`);
  }
  if (infraBits.length > 0) {
    writeFile(path.join(dossierDir, '_data', 'infrastructure.md'), `---
title: "Infrastructure Signals"
type: reference
last_updated: ${today}
---

# Infrastructure Signals (automated)

${infraBits.join('\n')}
`);
    count++;
  }

  // -- Comprehensive source list (every link the agents pulled). -------------
  const sources = syn.sources || [];
  if (sources.length > 0) {
    const lines = sources
      .slice()
      .sort((a, b) => a.url.localeCompare(b.url))
      .map((s, i) => `${i + 1}. ${s.title ? `[${s.title.replace(/[\[\]]/g, '')}](${s.url})` : `<${s.url}>`}`);
    writeFile(path.join(dossierDir, 'sources.md'), `---
title: "Sources"
type: reference
last_updated: ${today}
---

# Sources — ${sources.length} links collected during research

Every web source the research agents pulled, deduplicated. Verify high-stakes claims against these.

${lines.join('\n')}
`);
    count++;
  }

  // -- README landing page (nav reflects only what exists). ------------------
  const navRows = [
    ...numbered.map((s, i) => `| ${i + 1} | [${s.title}](${s.folder}/research.md) |`),
  ];
  if (syn.swotAnalysis || syn.keyFindings || syn.manualResearchNeeded || syn.riskRegister || syn.verification) {
    navRows.push(`| ${numbered.length + 1} | [Analysis — SWOT, risk register, findings, verification](${analysisFolder}/) |`);
  }
  if ((syn.sources || []).length > 0) {
    navRows.push(`| 📎 | [Sources — ${(syn.sources || []).length} links](sources.md) |`);
  }

  writeFile(path.join(dossierDir, 'README.md'), `---
title: "${companyName} — Intelligence Dossier"
type: reference
last_updated: ${today}
generated_by: company-dossier (ai web research)
---

# ${companyName} — Intelligence Dossier

${syn.oneLiner ? `> ${syn.oneLiner}` : ''}

**Type:** ${syn.entityType || 'n/a'} · **Website:** ${data.baseUrl || 'n/a'}

| Sections | Sources | Web searches | Trust | Est. cost |
|---|---|---|---|---|
| ${numbered.length} | ${(syn.sources || []).length} | ${syn.searches || 0} | ${syn.trust || 'n/a'} | ~$${(syn.costUSD || 0).toFixed(2)} |
${syn.verification ? `\n> 🔎 **[Independently verified](${analysisFolder}/verification.md)** — read before relying on high-stakes claims.\n` : ''}

## Executive Brief

${syn.executiveBrief}

## Sections

| # | Section |
|---|---------|
${navRows.join('\n')}

---

*Generated ${today} by Company Dossier — parallel AI web-research agents. Only sections with substantive findings are included.*
`);
  count++;

  // -- ROUTER for AI agents (reflects only present sections). -----------------
  const routerRows = numbered.map(s => `| ${s.title}? | ${s.folder}/research.md |`);
  if (syn.swotAnalysis) { routerRows.push(`| SWOT / strengths / threats? | ${analysisFolder}/swot.md |`); }
  if (syn.riskRegister) { routerRows.push(`| Risks / risk register? | ${analysisFolder}/risk_register.md |`); }
  if (syn.keyFindings) { routerRows.push(`| Top findings? | ${analysisFolder}/key_findings.md |`); }
  if (syn.verification) { routerRows.push(`| How trustworthy / verified? | ${analysisFolder}/verification.md |`); }
  if ((syn.sources || []).length > 0) { routerRows.push(`| All sources / links? | sources.md |`); }
  writeFile(path.join(dossierDir, 'ROUTER.md'), `---
title: "Question Router"
type: reference
last_updated: ${today}
---

# Question Router

> Find the question closest to yours, follow the path.

| Question | File |
|----------|------|
| Quick summary / what is it? | README.md |
${routerRows.join('\n')}
`);
  count++;

  // -- Methodology note. -----------------------------------------------------
  writeFile(path.join(dossierDir, '_meta', 'methodology.md'), `---
title: "Methodology"
type: reference
last_updated: ${today}
---

# Methodology

Public sources only. Generated by the Company Dossier extension using parallel AI research agents, each running live web search over one domain (identity, offerings, market, competitors, context, finances/brand), followed by a synthesis pass. Only sections with substantive, sourced findings are written — empty/irrelevant sections are omitted by design.

Confidence tags: **[HIGH]** = multiple independent sources or primary source; **[MEDIUM]** = single credible source; **[LOW]** = inference or weak source. Verify high-stakes claims against the cited URLs.
`);
  count++;

  return count;
}

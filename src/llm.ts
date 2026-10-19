// ---------------------------------------------------------------------------
// Research engine — parallel web-research agents + synthesis.
//
// Mirrors a human research workflow: fan out several focused agents (each does
// its own web_search over one domain — identity, offerings, market, etc.), then
// a synthesis agent reads everything and writes the brief / findings / SWOT.
//
// Each agent emits ONLY the sections it could fill with real, sourced content,
// so the generated dossier is dynamic — no empty template sections.
//
// Calls the Anthropic Messages API directly over fetch() (no SDK to bundle).
// ---------------------------------------------------------------------------

import { PageExtractions } from './extract';
import { WebsiteData } from './collectors/website';
import { WaybackData } from './collectors/wayback';
import { DnsData } from './collectors/dns';
import { TechStackData } from './collectors/techstack';
import { SearchData } from './collectors/search';

export interface DossierSection {
  slug: string;
  title: string;
  content: string;
}

export interface LLMSynthesis {
  oneLiner: string;
  entityType: string;
  executiveBrief: string;
  keyFindings: string;
  swotAnalysis: string;
  riskRegister: string;
  manualResearchNeeded: string;
  verification: string; // independent fact-check report
  sections: DossierSection[]; // ordered, only sections that have real content
  sources: Array<{ url: string; title: string }>; // every source the agents pulled
  trust: string; // High / Medium / Low from the verifier
  tokensIn: number;
  tokensOut: number;
  searches: number;
  costUSD: number;
}

/** Structured progress events the UI renders as a true pipeline. */
export type StageEvent =
  | { type: 'stage'; stage: string; status: 'active' | 'done'; detail?: string }
  | { type: 'agent'; id: string; label: string; status: 'running' | 'done' | 'failed'; detail?: string }
  | { type: 'metrics'; input: number; output: number; searches: number; sources: number; cost: number };
export type OnStage = (e: StageEvent) => void;

interface CollectedIntelligence {
  companyName: string;
  baseUrl: string;
  domain: string;
  website?: WebsiteData;
  wayback?: WaybackData;
  dns?: DnsData;
  tech?: TechStackData;
  search?: SearchData;
  extractions: PageExtractions;
  pageTexts: Array<{ url: string; title: string; text: string; type: string }>;
  focusText?: string;
  model?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

// --- Token/cost accounting -------------------------------------------------
interface Usage { input: number; output: number; searches: number; }
function addUsage(u: Usage | undefined, d: any): void {
  if (!u || !d?.usage) { return; }
  u.input += (d.usage.input_tokens || 0) + (d.usage.cache_read_input_tokens || 0) + (d.usage.cache_creation_input_tokens || 0);
  u.output += d.usage.output_tokens || 0;
  u.searches += d.usage.server_tool_use?.web_search_requests || 0;
}
function estimateCost(model: string, u: Usage): number {
  const rates: Record<string, [number, number]> = {
    'claude-haiku-4-5': [1, 5], 'claude-sonnet-4-6': [3, 15], 'claude-opus-4-8': [5, 25],
  };
  const [inR, outR] = rates[model] || [3, 15];
  return (u.input / 1e6) * inR + (u.output / 1e6) * outR + (u.searches / 1000) * 10; // web search $10/1k
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Strip leaked between-search narration lines from model output. */
function stripNarration(s: string): string {
  return s.split('\n')
    .filter(l => !/^\s*(I'll|I will|Let me|Now I|Now I'll|Good[—,. ]|I have (enough|sufficient)|Here'?s my|I'm going to|Okay,|OK,|First,? (I|let)|Based on (all )?(the|my))\b/i.test(l))
    .join('\n').trim();
}

/** One POST with a per-request timeout + retry on network errors / 429 / 5xx. */
async function postMessages(apiKey: string, model: string, body: any, progress: (m: string) => void): Promise<any> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 240000); // 4 min per HTTP round (web_search can be slow)
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify({ model, ...body }),
      });
      if (resp.status === 429 || resp.status >= 500) {
        const b = await resp.text().catch(() => '');
        if (attempt < maxAttempts) { progress(`  (retry ${attempt}/${maxAttempts}: HTTP ${resp.status})`); await sleep(2500 * attempt); continue; }
        throw new Error(`Anthropic API ${resp.status}: ${b.slice(0, 300)}`);
      }
      if (!resp.ok) {
        const b = await resp.text().catch(() => '');
        throw new Error(`Anthropic API ${resp.status}: ${b.slice(0, 300)}`);
      }
      return await resp.json();
    } catch (e: any) {
      const msg = String(e?.message || e);
      const networkish = /fetch failed|aborted|abort|ECONN|ETIMEDOUT|timeout|network|terminated|socket/i.test(msg);
      if (networkish && attempt < maxAttempts) { progress(`  (retry ${attempt}/${maxAttempts}: ${msg})`); await sleep(2500 * attempt); continue; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('unreachable');
}

/** Collect source URLs the web_search tool actually returned. */
function collectSources(sources: Map<string, string> | undefined, data: any): void {
  if (!sources) { return; }
  for (const b of (data.content || [])) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) { if (r && r.url) { sources.set(r.url, r.title || sources.get(r.url) || ''); } }
    }
  }
}

async function callClaude(
  apiKey: string, model: string, prompt: string, maxTokens: number,
  webSearchUses: number, progress: (msg: string) => void, usage?: Usage,
  sources?: Map<string, string>, maxRounds = 14
): Promise<string> {
  const tools = webSearchUses > 0
    // allowed_callers:["direct"] is REQUIRED for models without programmatic
    // tool calling (e.g. Haiku 4.5) — otherwise web_search 400s.
    ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: webSearchUses, allowed_callers: ['direct'] }]
    : undefined;
  let messages: any[] = [{ role: 'user', content: prompt }];
  for (let round = 0; round < maxRounds; round++) {
    const data = await postMessages(apiKey, model, { max_tokens: maxTokens, ...(tools ? { tools } : {}), messages }, progress);
    addUsage(usage, data);
    collectSources(sources, data);
    if (data.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: data.content }];
      continue;
    }
    return (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text).join('\n').trim();
  }
  throw new Error('research did not converge within round limit');
}

/** Parse `===SECTION: slug | Title===` blocks. Drops near-empty sections. */
function parseSections(text: string): DossierSection[] {
  const out: DossierSection[] = [];
  const parts = text.split(/===SECTION:\s*([a-zA-Z_]+)\s*\|\s*([^\n]+?)\s*===/);
  for (let i = 1; i < parts.length; i += 3) {
    const slug = (parts[i] || '').trim().toLowerCase();
    const title = (parts[i + 1] || '').trim();
    const content = (parts[i + 2] || '').trim();
    // Skip sections the agent left empty or marked as "not found".
    if (slug && title && content.length > 120 && !/^(\s*none found\.?\s*|n\/a\.?)$/i.test(content)) {
      out.push({ slug, title, content });
    }
  }
  return out;
}

function buildContext(data: CollectedIntelligence): string {
  const s: string[] = [`Target: ${data.companyName}\nWebsite: ${data.baseUrl}\nDomain: ${data.domain}`];
  const w = data.website;
  if (w && (w.title || (w.pageCount || 0) > 0)) {
    s.push(`Live site: title="${w.title || ''}", ${w.pageCount} pages crawled. Description: ${(w.description || '').slice(0, 300)}`);
    if (w.allEmails?.length) { s.push(`Emails on site: ${w.allEmails.join(', ')}`); }
    if (w.schemaOrg) { s.push(`Schema.org: ${JSON.stringify(w.schemaOrg).slice(0, 300)}`); }
  } else {
    s.push('Live crawl returned little/nothing (bot protection / JS app / 403). Research entirely via web_search.');
  }
  if (data.extractions?.aboutText) { s.push(`About (site): ${data.extractions.aboutText.slice(0, 800)}`); }
  if (data.search?.socialProfiles?.length) {
    // Cap — the HTML collector over-extracts (hundreds of unrelated links).
    s.push(`Social profiles: ${data.search.socialProfiles.slice(0, 12).map(p => `${p.platform} ${p.url}`).join(' | ')}`);
  }
  if (data.dns && !data.dns.error) { s.push(`Email/DNS: ${data.dns.emailProvider}; subdomains: ${data.dns.subdomains.slice(0, 6).join(', ')}`); }
  if (data.wayback && !data.wayback.error && data.wayback.firstCapture) { s.push(`Wayback first seen: ${data.wayback.firstCapture}`); }
  if (data.pageTexts?.length) {
    s.push('Key page text:\n' + data.pageTexts.slice(0, 8).map(p => `[${p.title || p.url}] ${p.text.slice(0, 600)}`).join('\n'));
  }
  return s.join('\n');
}

const RULES = `RULES:
- Use web_search aggressively to research the target directly — the automated crawl is often blocked/empty.
- SEARCH STRATEGY: start with SHORT, BROAD queries, evaluate what comes back, then progressively narrow. Do NOT lead with long hyper-specific queries (they return little). Run several searches; stop when new searches stop surfacing new sources.
- Triangulate across multiple independent sources; prefer official/primary, then reputable press, then aggregators.
- Cite every non-obvious claim inline with a REAL source URL you found. Tag major claims [HIGH]/[MEDIUM]/[LOW].
- Be quantitative (numbers, $, dates, sqft, ratings, counts). Never fabricate sources, figures, or quotes.
- Adapt to the entity type (SaaS, local business, apartment/property, nonprofit, agency...). Use entity-appropriate section TITLES.
- CRITICAL: only emit a ===SECTION=== if you found substantive, sourced content for it. SKIP sections you cannot fill. Do not pad. Do not output empty/placeholder sections.
- Output ONLY ===SECTION: slug | Title=== blocks of polished markdown. No preamble, no closing remarks.`;

interface AgentDef { id: string; label: string; assignment: string; }

const AGENTS: AgentDef[] = [
  {
    id: 'identity_people', label: 'identity & people',
    assignment: `Research the entity's IDENTITY and PEOPLE.
- ===SECTION: identity | <Title>=== legal/operating name, exact address/HQ, founding/opening date, size (employees/units/locations), ownership & parent entity, operator/management company, legal registrations, and a contacts block (phones, emails, office).
- ===SECTION: people | <Title>=== named owners/founders/executives/managers with titles, orgs, and LinkedIn/source URLs; short org profiles. For property/local biz: developer, owner, property manager, GC, architect.`,
  },
  {
    id: 'offerings', label: 'offerings & marketing',
    assignment: `Research what the entity OFFERS and how it MARKETS.
- ===SECTION: offerings | <Title>=== products/services/unit-types with REAL specs and PRICING ($ ranges). Property: floor-plan table (type | sqft | beds/baths | rent), amenities, fees, lease terms. SaaS: products, plans, prices.
- ===SECTION: marketing | <Title>=== channels & presence: website/CMS, social handles + follower/engagement signals, advertising activity, listing syndication, notable campaigns.`,
  },
  {
    id: 'market', label: 'customers & competitors',
    assignment: `Research the entity's MARKET, CUSTOMERS and COMPETITORS.
- ===SECTION: customers | <Title>=== target customer/resident profile + market sentiment: ratings & review counts per platform (Google/Yelp/apartments.com/G2/etc.), representative quotes, praise vs. complaint themes, demand signals.
- ===SECTION: competitors | <Title>=== 6-10 named competitors in a comparison table (name | key stats | price | rating | source URL), then a positioning read (price/quality position, edge, disadvantage).`,
  },
  {
    id: 'context', label: 'industry & timeline',
    assignment: `Research CONTEXT and HISTORY.
- ===SECTION: industry | <Title>=== industry/market context with numbers (market size, trends; for property: vacancy/rent trends, neighborhood), key regulations affecting the entity, structural tailwinds/headwinds.
- ===SECTION: timeline | <Title>=== dated timeline of key events (founding, milestones, openings, ownership changes, relevant site/history) as a table with confidence tags.`,
  },
  {
    id: 'money_brand', label: 'financials & brand',
    assignment: `Research FINANCES and BRAND.
- ===SECTION: financials | <Title>=== known economics: revenue/funding/valuation/lender/cost if findable, plus honest gaps and where to verify (named registries/portals). Label estimates clearly.
- ===SECTION: brand | <Title>=== brand identity: name meaning, positioning, voice, visual identity, brand architecture, brand-strength read.`,
  },
  {
    id: 'diligence', label: 'ownership, legal, IP & suppliers',
    assignment: `Research DUE-DILIGENCE dimensions. Check official registries, not just the company's own site.
- ===SECTION: ownership | <Title>=== corporate structure: parent company, subsidiaries, beneficial owners, related entities, registration jurisdiction & entity IDs. Sources: SEC EDGAR (edgar/search), state Secretary of State, OpenCorporates, UK Companies House, GLEIF/LEI.
- ===SECTION: legal | <Title>=== litigation, regulatory actions/enforcement, sanctions, liens, major disputes, recalls (court records, regulator sites, news). If the record is clean after searching, SAY SO explicitly.
- ===SECTION: ip | <Title>=== intellectual property — patents, trademarks, notable IP (USPTO trademark/patent search, Google Patents). SKIP if none found.
- ===SECTION: suppliers | <Title>=== key suppliers, partners, vendors, integrations, distribution, and supply-chain/partnership dependencies.`,
  },
];

const CANONICAL_ORDER = ['identity', 'ownership', 'people', 'offerings', 'suppliers', 'customers', 'competitors', 'financials', 'marketing', 'brand', 'ip', 'legal', 'timeline', 'industry'];

async function runAgent(apiKey: string, model: string, name: string, context: string, agent: AgentDef, focusText: string | undefined, progress: (m: string) => void, usage: Usage, sources: Map<string, string>, onStage?: OnStage): Promise<DossierSection[]> {
  onStage?.({ type: 'agent', id: agent.id, label: agent.label, status: 'running' });
  const prompt = `You are a competitive-intelligence research analyst investigating "${name}".

What automated collection found:
${context}

${RULES}

YOUR ASSIGNMENT:
${agent.assignment}${focusText ? `\n\nThe researcher specifically wants: ${focusText} — prioritize where relevant.` : ''}`;
  try {
    const text = await callClaude(apiKey, model, prompt, 6000, 10, progress, usage, sources);
    const sections = parseSections(text);
    progress(`  ✓ ${agent.label}: ${sections.length} section(s)`);
    onStage?.({ type: 'agent', id: agent.id, label: agent.label, status: 'done', detail: `${sections.length} section${sections.length === 1 ? '' : 's'}` });
    return sections;
  } catch (e: any) {
    progress(`  ✗ ${agent.label} failed: ${e.message}`);
    onStage?.({ type: 'agent', id: agent.id, label: agent.label, status: 'failed', detail: String(e.message).slice(0, 70) });
    return [];
  }
}

async function runSynthesis(apiKey: string, model: string, name: string, sections: DossierSection[], progress: (m: string) => void, usage: Usage, sources: Map<string, string>): Promise<{ oneLiner: string; entityType: string; executiveBrief: string; keyFindings: string; swotAnalysis: string; riskRegister: string; manualResearchNeeded: string }> {
  // Feed the synthesis agent the FULL research traces (not lossy summaries) —
  // the synthesis seam is interdependent and degrades on truncated input.
  const merged = sections.map(s => `## ${s.title}\n${s.content.slice(0, 6000)}`).join('\n\n');
  const prompt = `You are the lead analyst. Your research team produced these sections on "${name}":

${merged || '(the research team found very little — note this honestly)'}

Write a synthesis using these exact markers. CRITICAL: output ONLY the marked content. Do NOT narrate your searches, do NOT write any preamble or commentary (no "I'll now compose...", "Let me search...", "Good, I have enough..."). Begin your reply directly with "===ONELINER===". You MAY use web_search up to 3 times to fill a critical hole, silently.

===ONELINER===
One sentence describing exactly what this entity is.
===TYPE===
Two or three words for the entity type (e.g. "apartment community", "B2B SaaS", "real estate developer").
===EXEC===
4-6 paragraph executive brief — what it is, scale, owners, market position, and the single most important signal. Evidence-based with confidence tags.
===FINDINGS===
12-20 findings as **[Finding]** — [evidence + source URL] (Confidence: H/M/L), grouped by category.
===SWOT===
### Strengths / ### Weaknesses / ### Opportunities / ### Threats — every bullet cites evidence or clear reasoning.
===RISK===
A prioritized risk register as a table: | # | Risk | Likelihood (H/M/L) | Impact (H/M/L) | Evidence/note |. Cover operational, financial, legal/regulatory, competitive, and reputational risks.
===GAPS===
Specific unverified gaps, why each matters, and exactly where to look.`;
  const text = await callClaude(apiKey, model, prompt, 7000, 3, progress, usage, sources);
  const get = (key: string) => {
    const m = text.match(new RegExp(`===${key}===([\\s\\S]*?)(?:===[A-Z]+===|$)`));
    return m ? m[1].trim() : '';
  };
  // Strip any leaked narration lines the model put before/inside a field.
  const denarrate = (s: string) => s
    .split('\n')
    .filter(l => !/^\s*(I'll|I will|Let me|Now I|Good[—,. ]|I have (enough|sufficient)|Here'?s|I'm going to|Okay,|OK,)\b/i.test(l))
    .join('\n').trim();
  const exec = denarrate(get('EXEC'));
  return {
    oneLiner: get('ONELINER').split('\n')[0].replace(/^["']|["']$/g, '').trim(),
    entityType: get('TYPE').split('\n')[0].trim(),
    executiveBrief: exec || denarrate(text),
    keyFindings: get('FINDINGS'),
    swotAnalysis: get('SWOT'),
    riskRegister: get('RISK'),
    manualResearchNeeded: get('GAPS'),
  };
}

/** Pull http(s) URLs out of markdown, dedupe, strip trailing punctuation. */
function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s)\]<>"']+/g) || [];
  const clean = found.map(u => u.replace(/[.,;:)\]]+$/, ''));
  return [...new Set(clean)];
}

/** Deterministic check: do the cited URLs actually resolve? */
async function checkUrls(urls: string[], progress: (m: string) => void): Promise<string> {
  const sample = urls.slice(0, 25);
  if (sample.length === 0) { return ''; }
  progress(`Verifier: checking ${sample.length} cited URL(s)...`);
  const results = await Promise.allSettled(sample.map(async (u) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompanyDossier/1.0)' } });
      return { u, ok: r.status < 400, status: r.status };
    } catch { return { u, ok: false, status: 0 }; }
    finally { clearTimeout(t); }
  }));
  const checked = results.map(r => r.status === 'fulfilled' ? r.value : { u: '?', ok: false, status: 0 });
  const dead = checked.filter(c => !c.ok);
  const alive = checked.length - dead.length;
  let out = `\n\n## Link check\n${alive}/${checked.length} sampled cited URLs resolved.`;
  if (dead.length) {
    out += `\n\n**Did NOT resolve (verify manually):**\n` + dead.map(d => `- ${d.u}${d.status ? ` (HTTP ${d.status})` : ' (no response)'}`).join('\n');
  }
  return out;
}

/** Independent, adversarial fact-check of the assembled dossier. Different instance than the writer. */
async function runVerification(apiKey: string, model: string, name: string, sections: DossierSection[], progress: (m: string) => void, usage: Usage, sources: Map<string, string>): Promise<string> {
  const merged = sections.map(s => `## ${s.title}\n${s.content.slice(0, 3500)}`).join('\n\n');
  if (!merged.trim()) { return ''; }
  const prompt = `You are an INDEPENDENT fact-checker auditing a dossier on "${name}" written by another analyst. Be skeptical and adversarial — your job is to catch unsupported, overstated, outdated, or fabricated claims, NOT to praise the work.

DOSSIER UNDER REVIEW:
${merged}

Use web_search to spot-check the most load-bearing, surprising, or quantitative claims (prices, ownership, dates, counts, legal status). Then write a concise report under EXACTLY these headings:

## Overall trust
High / Medium / Low, with one-paragraph reasoning.
## Independently confirmed
The key claims you verified against an independent source (with the URL you checked).
## Unsupported or questionable
Claims with no citation, where the cited source likely doesn't support the claim, or that you could not corroborate.
## Corrections
Anything you found to be wrong or outdated, with the correct value + source.

Be specific and brief. If the dossier is solid, say so plainly.`;
  try {
    const text = await callClaude(apiKey, model, prompt, 4000, 6, progress, usage, sources);
    return stripNarration(text);
  } catch (e: any) {
    progress(`Verifier failed: ${e.message}`);
    return `_Verification could not be completed: ${e.message}_`;
  }
}

export async function synthesizeWithLLM(
  data: CollectedIntelligence,
  apiKey: string,
  _depth: 'quick' | 'standard' | 'deep', // ignored — always runs the full fan-out
  progress: (msg: string) => void,
  onStage?: OnStage
): Promise<LLMSynthesis | undefined> {
  const model = data.model || DEFAULT_MODEL;
  progress(`AI research (${model}): ${AGENTS.length} parallel agents → synthesis → verification`);

  const usage: Usage = { input: 0, output: 0, searches: 0 };
  const sources = new Map<string, string>();
  const emitMetrics = () => onStage?.({ type: 'metrics', input: usage.input, output: usage.output, searches: usage.searches, sources: sources.size, cost: estimateCost(model, usage) });
  const logUsage = (stage: string) => { progress(`[tokens] ${stage}: ${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out · ${usage.searches} searches · ${sources.size} sources · est ~$${estimateCost(model, usage).toFixed(2)}`); emitMetrics(); };

  try {
    const context = buildContext(data);

    // Stage 1: fan out research agents in parallel.
    onStage?.({ type: 'stage', stage: 'research', status: 'active', detail: `${AGENTS.length} agents` });
    progress(`Researching — ${AGENTS.length} agents searching the web in parallel`);
    const results = await Promise.all(
      AGENTS.map(a => runAgent(apiKey, model, data.companyName, context, a, data.focusText, progress, usage, sources, onStage))
    );
    onStage?.({ type: 'stage', stage: 'research', status: 'done' });
    logUsage('after research');

    // Merge + dedupe by slug (first wins), order canonically.
    const bySlug = new Map<string, DossierSection>();
    for (const list of results) {
      for (const sec of list) { if (!bySlug.has(sec.slug)) { bySlug.set(sec.slug, sec); } }
    }
    const sections = [...bySlug.values()].sort((a, b) => {
      const ai = CANONICAL_ORDER.indexOf(a.slug); const bi = CANONICAL_ORDER.indexOf(b.slug);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    // Stage 2: synthesis.
    onStage?.({ type: 'stage', stage: 'synthesize', status: 'active' });
    progress('Synthesizing — executive brief, findings, SWOT & risk register');
    const syn = await runSynthesis(apiKey, model, data.companyName, sections, progress, usage, sources);
    onStage?.({ type: 'stage', stage: 'synthesize', status: 'done' });

    // Stage 3: independent verification (adversarial fact-check + URL liveness).
    onStage?.({ type: 'stage', stage: 'verify', status: 'active' });
    progress('Verifying — independent fact-check + link check');
    let verification = await runVerification(apiKey, model, data.companyName, sections, progress, usage, sources);
    const allText = sections.map(s => s.content).join('\n') + '\n' + syn.executiveBrief + '\n' + syn.keyFindings;
    verification += await checkUrls(extractUrls(allText), progress);
    onStage?.({ type: 'stage', stage: 'verify', status: 'done' });

    const trustMatch = verification.match(/Overall trust[\s\S]{0,60}?\b(High|Medium|Low)\b/i);
    const trust = trustMatch ? trustMatch[1] : '';
    const cost = estimateCost(model, usage);
    logUsage('full run');
    progress(`Done — ${sections.length} sections · ${sources.size} sources · ${usage.searches} searches · est ~$${cost.toFixed(2)}`);
    verification = `_Run cost: ~$${cost.toFixed(2)} · ${usage.input.toLocaleString()} input + ${usage.output.toLocaleString()} output tokens · ${usage.searches} web searches · ${sources.size} sources · model ${model}_\n\n` + verification;

    return {
      ...syn, verification, sections, trust,
      sources: [...sources.entries()].map(([url, title]) => ({ url, title })),
      tokensIn: usage.input, tokensOut: usage.output, searches: usage.searches, costUSD: cost,
    };
  } catch (err: any) {
    progress(`AI research FAILED: ${err.message}`);
    onStage?.({ type: 'stage', stage: 'research', status: 'done', detail: 'failed' });
    return undefined;
  }
}

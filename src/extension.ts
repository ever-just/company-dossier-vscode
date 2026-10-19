import * as vscode from 'vscode';
import * as path from 'path';
import { DossierSidebarProvider } from './sidebar/provider';
import { runResearch, ResearchInput } from './agent';
import { slugify } from './utils';

/** Read the Anthropic API key from VS Code settings. */
function getAnthropicApiKey(): string {
  return vscode.workspace.getConfiguration('companyDossier').get<string>('anthropicApiKey', '');
}

/** Read the configured Anthropic model. */
function getModel(): string {
  return vscode.workspace.getConfiguration('companyDossier').get<string>('model', 'claude-haiku-4-5');
}

export function activate(context: vscode.ExtensionContext): void {

  // === DEV LOGS ===
  // LogOutputChannel gives timestamped info/warn/error lines in
  // Output → "Company Dossier". Everything the pipeline does is logged here.
  const log = vscode.window.createOutputChannel('Company Dossier', { log: true });
  context.subscriptions.push(log);
  log.info(`Company Dossier activated (v${context.extension?.packageJSON?.version ?? '?'})`);
  context.subscriptions.push(
    vscode.commands.registerCommand('companyDossier.showLogs', () => log.show(true))
  );

  // === SIDEBAR WEBVIEW ===
  const sidebarProvider = new DossierSidebarProvider(context.extensionUri, log);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DossierSidebarProvider.viewType,
      sidebarProvider,
      // Keep the webview's DOM/state alive when the view is hidden (user switches
      // to another activity-bar view and back). Without this, VS Code disposes the
      // webview and resolveWebviewView re-runs with fresh HTML, wiping all state.
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // === CHAT PARTICIPANT (for Copilot users) ===
  try {
    const participant = vscode.chat.createChatParticipant('company-dossier.agent', async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      const prompt = request.prompt.trim();

      if (request.command === 'research' || prompt.toLowerCase().startsWith('research')) {
        // Parse: "research Acme Corp https://acme.com"
        const parts = prompt.replace(/^research\s*/i, '').trim();
        const urlMatch = parts.match(/(https?:\/\/[^\s]+)/);
        const url = urlMatch ? urlMatch[1] : '';
        const companyName = parts.replace(url, '').trim();

        if (!companyName || !url) {
          stream.markdown('**Usage:** `@dossier /research Company Name https://company.com`\n\nPlease provide both a company name and URL.');
          return { metadata: { command: 'research' } };
        }

        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
          stream.markdown('**Error:** Please open a folder in VS Code first.');
          return { metadata: { command: 'research' } };
        }

        const apiKey = getAnthropicApiKey();
        stream.progress(`Starting deep research on ${companyName}...${apiKey ? ' (AI analysis enabled)' : ' (no API key — template mode)'}`);

        const input: ResearchInput = { companyName, url, depth: 'standard', apiKey: apiKey || undefined, model: getModel() };
        const result = await runResearch(input, root, (msg) => {
          stream.progress(msg);
        });

        // Stream results
        stream.markdown(`# ${companyName} — Dossier Generated\n\n`);
        stream.markdown(`**${result.filesCreated} files** created in \`${companyName} DOSSIER/\`\n\n`);

        // Intelligence summary
        const c = result.counts;
        stream.markdown(`## Intelligence Extracted\n| Finding | Count |\n|---------|-------|\n| Team members | ${c.people} |\n| Products/services | ${c.products} |\n| Client case studies | ${c.caseStudies} |\n| Partners | ${c.partners} |\n| Emails | ${c.emails} |\n| Social profiles | ${c.socialProfiles} |\n| Gov contracts | ${c.govContracts} |\n\n`);

        if (result.websiteData) {
          stream.markdown(`## Website\n- **Title:** ${result.websiteData.title}\n- **Pages crawled:** ${result.websiteData.pageCount}\n- **Sitemap URLs:** ${result.websiteData.sitemapUrls.length}\n\n`);
        }

        if (result.waybackData && !result.waybackData.error) {
          stream.markdown(`## Wayback Machine\n- **Captures:** ${result.waybackData.totalCaptures}\n- **PDFs Found:** ${result.waybackData.pdfUrls.length}\n- **Deleted Pages:** ${result.waybackData.deletedPages.length}\n\n`);
        }

        if (result.techData) {
          stream.markdown(`## Tech Stack\n- **CMS:** ${result.techData.cms}\n- **Analytics:** ${result.techData.analyticsIds.join(', ') || 'None detected'}\n- **Frameworks:** ${result.techData.frameworks.join(', ') || 'None detected'}\n\n`);
        }

        if (result.llmSynthesis) {
          stream.markdown(`## AI Research\n- ${result.llmSynthesis.sections.length} research sections generated\n- Executive Brief, Key Findings, SWOT: generated\n`);
        }

        if (result.errors.length > 0) {
          stream.markdown(`## Warnings\n${result.errors.map(e => '- ' + e).join('\n')}\n\n`);
        }

        stream.markdown(`\n---\n*Open \`${companyName} DOSSIER/README.md\` to browse the full dossier.*`);

        // Open README
        const readmePath = path.join(result.dossierPath, 'README.md');
        stream.button({ command: 'vscode.open', title: 'Open Dossier', arguments: [vscode.Uri.file(readmePath)] });

        return { metadata: { command: 'research' } };
      }

      // Default: help
      const apiKey = getAnthropicApiKey();
      stream.markdown(`# Company Dossier Agent\n\nI build structured competitive intelligence dossiers.\n\n**API Key Status:** ${apiKey ? 'Configured (AI analysis enabled)' : 'Not set (template mode) — add in Settings > Company Dossier'}\n\n**Commands:**\n- \`/research Company Name https://company.com\` — Generate a full dossier\n\n**What I collect (9-phase pipeline):**\n1. Scaffold dossier structure\n2. Website deep crawl (homepage + sitemap + up to 50 pages)\n3. Wayback Machine (3 CDX queries + PDF discovery)\n4. DNS reconnaissance (MX, SPF, DMARC, subdomains)\n5. Tech stack extraction (CMS, analytics, ad pixels, CDN)\n6. Public search (USASpending + social profile discovery)\n7. AI synthesis (executive brief, SWOT, key findings) *requires API key*\n8. Generate content files\n9. Build ROUTER.md navigation index\n\n**What I create:**\n- 12-section folder structure with YAML frontmatter\n- Pre-populated corporate identity, tech stack, and timeline files\n- Product portfolio from sitemap analysis\n- Social media presence report\n- Federal contracts summary\n- AI-generated executive brief, SWOT, and findings (with API key)\n- ROUTER.md for AI agent navigation\n`);

      return { metadata: { command: '' } };
    });

    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

    // Follow-up suggestions
    participant.followupProvider = {
      provideFollowups(result, context, token) {
        return [
          { prompt: '/research ', label: 'Research a company' },
        ];
      }
    };

    context.subscriptions.push(participant);
  } catch {
    // Chat API not available (no Copilot) — sidebar still works
  }

  // === COMMAND: Quick research via command palette ===
  context.subscriptions.push(
    vscode.commands.registerCommand('companyDossier.research', async () => {
      const companyName = await vscode.window.showInputBox({
        prompt: 'Company name',
        placeHolder: 'e.g., Acme Corp'
      });
      if (!companyName) { return; }

      const url = await vscode.window.showInputBox({
        prompt: 'Website URL',
        placeHolder: 'https://acme.com'
      });
      if (!url) { return; }

      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage('Open a folder first.');
        return;
      }

      const apiKey = getAnthropicApiKey();

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Researching ${companyName}...`,
        cancellable: false
      }, async (progress) => {
        const input: ResearchInput = { companyName, url, depth: 'standard', apiKey: apiKey || undefined, model: getModel() };
        log.info(`Research (command): "${companyName}" <${url}> apiKey=${apiKey ? 'set' : 'MISSING'} model=${getModel()}`);
        const result = await runResearch(input, root, (msg) => {
          log.appendLine(msg);
          progress.report({ message: msg });
        });

        const aiNote = result.llmSynthesis ? ' (with AI analysis)' : '';
        vscode.window.showInformationMessage(
          `Dossier created: ${result.filesCreated} files in ${companyName} DOSSIER/${aiNote}`,
          'Open'
        ).then(selection => {
          if (selection === 'Open') {
            const readmePath = path.join(result.dossierPath, 'README.md');
            vscode.commands.executeCommand('vscode.open', vscode.Uri.file(readmePath));
          }
        });
      });
    })
  );

  // === COMMAND: New Entity Profile ===
  context.subscriptions.push(
    vscode.commands.registerCommand('companyDossier.newEntity', async () => {
      const entityType = await vscode.window.showQuickPick(
        ['person', 'supplier', 'competitor', 'client', 'product'],
        { placeHolder: 'Entity type' }
      );
      if (!entityType) { return; }

      const name = await vscode.window.showInputBox({ prompt: `${entityType} name` });
      if (!name) { return; }

      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) { return; }

      const sectionMap: Record<string, string> = {
        person: '2_people/profiles', supplier: '4_suppliers/profiles',
        competitor: '6_competitors/profiles', client: '5_customers', product: '3_products'
      };

      const slug = slugify(name);
      const section = sectionMap[entityType] || '11_analysis';

      // Find dossier root
      const fs = require('fs');
      const entries = fs.readdirSync(root);
      let dossierRoot = root;
      for (const entry of entries) {
        if (entry.endsWith('DOSSIER') && fs.statSync(path.join(root, entry)).isDirectory()) {
          dossierRoot = path.join(root, entry);
          break;
        }
      }

      const filePath = path.join(dossierRoot, section, `${slug}.md`);
      const { writeFile } = require('./utils');
      const { todayISO } = require('./utils');
      writeFile(filePath, `---\ntitle: "${name}"\ntype: entity-profile\nentity_type: ${entityType}\nentity_id: ${slug}\nconfidence: moderate\nlast_updated: ${todayISO()}\ntags: []\n---\n\n# ${name}\n\n## Overview\n\n\n## Key Facts\n\n| Attribute | Value |\n|-----------|-------|\n\n## Evidence\n\n\n## Risk & Opportunity\n\n`);

      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`Created ${entityType} profile: ${slug}.md`);
    })
  );
}

export function deactivate(): void {}

import * as vscode from 'vscode';
import * as path from 'path';
import { DossierSidebarProvider } from './sidebar/provider';
import { runResearch, ResearchInput } from './agent';
import { slugify } from './utils';

export function activate(context: vscode.ExtensionContext): void {

  // === SIDEBAR WEBVIEW ===
  const sidebarProvider = new DossierSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DossierSidebarProvider.viewType, sidebarProvider)
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

        stream.progress(`Starting research on ${companyName}...`);

        const input: ResearchInput = { companyName, url, depth: 'standard' };
        const result = await runResearch(input, root, (msg) => {
          stream.progress(msg);
        });

        // Stream results
        stream.markdown(`# ${companyName} — Dossier Generated\n\n`);
        stream.markdown(`**${result.filesCreated} files** created in \`${companyName} DOSSIER/\`\n\n`);

        if (result.websiteData) {
          stream.markdown(`## Website\n- **Title:** ${result.websiteData.title}\n- **Description:** ${result.websiteData.description}\n- **Sitemap URLs:** ${result.websiteData.sitemapUrls.length}\n\n`);
        }

        if (result.waybackData && !result.waybackData.error) {
          stream.markdown(`## Wayback Machine\n- **Captures:** ${result.waybackData.totalCaptures}\n- **Unique URLs:** ${result.waybackData.uniqueUrls.length}\n- **PDFs Found:** ${result.waybackData.pdfUrls.length}\n- **Deleted Pages:** ${result.waybackData.deletedPages.length}\n\n`);
        }

        if (result.dnsData && !result.dnsData.error) {
          stream.markdown(`## Email & DNS\n- **Provider:** ${result.dnsData.emailProvider}\n- **SPF:** ${result.dnsData.spfRecord ? 'Yes' : 'No'}\n- **DMARC:** ${result.dnsData.dmarcRecord ? 'Yes' : 'No'}\n\n`);
        }

        if (result.techData) {
          stream.markdown(`## Tech Stack\n- **CMS:** ${result.techData.cms}\n- **Analytics:** ${result.techData.analyticsIds.join(', ') || 'None detected'}\n- **Ad Pixels:** ${result.techData.adPixels.join(', ') || 'None detected'}\n\n`);
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
      stream.markdown(`# Company Dossier Agent\n\nI build structured competitive intelligence dossiers.\n\n**Commands:**\n- \`/research Company Name https://company.com\` — Generate a full dossier\n\n**What I collect:**\n- Website content (title, description, schema.org, social links)\n- Wayback Machine history (captures, deleted pages, PDFs)\n- DNS reconnaissance (email provider, SPF, DMARC)\n- Tech stack (CMS, analytics, ad pixels, CDN)\n\n**What I create:**\n- 12-section folder structure with YAML frontmatter\n- Pre-populated corporate identity, tech stack, and timeline files\n- ROUTER.md for AI agent navigation\n- MOC (Map of Content) per section\n`);

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

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Researching ${companyName}...`,
        cancellable: false
      }, async (progress) => {
        const input: ResearchInput = { companyName, url, depth: 'standard' };
        const result = await runResearch(input, root, (msg) => {
          progress.report({ message: msg });
        });

        vscode.window.showInformationMessage(
          `Dossier created: ${result.filesCreated} files in ${companyName} DOSSIER/`,
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
      const entries = require('fs').readdirSync(root);
      let dossierRoot = root;
      for (const entry of entries) {
        if (entry.endsWith('DOSSIER') && require('fs').statSync(path.join(root, entry)).isDirectory()) {
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

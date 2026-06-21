import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runResearch } from '../agent';
import { ResearchInput } from '../types';

export class DossierSidebarProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'companyDossier.sidebar';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    // Update API key status when settings change
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('companyDossier.anthropicApiKey')) {
        this._sendMessage({ type: 'apiKeyStatus', hasKey: !!this._getApiKey() });
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'research') {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
          this._sendMessage({ type: 'error', text: 'Open a folder first.' });
          return;
        }

        const apiKey = this._getApiKey();

        const input: ResearchInput = {
          companyName: message.companyName,
          url: message.url,
          depth: message.depth || 'standard',
          apiKey: apiKey || undefined
        };

        this._sendMessage({ type: 'status', text: 'Starting deep research pipeline...' });
        if (apiKey) {
          this._sendMessage({ type: 'status', text: 'AI analysis enabled (API key found)' });
        } else {
          this._sendMessage({ type: 'status', text: 'Template mode (add API key in settings for AI analysis)' });
        }

        try {
          const result = await runResearch(input, root, (msg) => {
            this._sendMessage({ type: 'status', text: msg });
          });

          this._sendMessage({
            type: 'complete',
            text: `Done! ${result.filesCreated} files created.${result.llmSynthesis ? ' AI analysis included.' : ''}`,
            errors: result.errors,
            path: result.dossierPath
          });

          // Open the dossier README
          const readmePath = path.join(result.dossierPath, 'README.md');
          if (fs.existsSync(readmePath)) {
            const doc = await vscode.workspace.openTextDocument(readmePath);
            await vscode.window.showTextDocument(doc);
          }

        } catch (err: any) {
          this._sendMessage({ type: 'error', text: err.message });
        }
      }

      if (message.type === 'openSettings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'companyDossier.anthropicApiKey');
      }
    });

    // Send initial API key status
    this._sendMessage({ type: 'apiKeyStatus', hasKey: !!this._getApiKey() });
  }

  private _getApiKey(): string {
    return vscode.workspace.getConfiguration('companyDossier').get<string>('anthropicApiKey', '');
  }

  private _sendMessage(message: any): void {
    this._view?.webview.postMessage(message);
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 12px;
    margin: 0;
  }
  h2 { font-size: 14px; margin: 0 0 12px; font-weight: 600; }
  label { display: block; font-size: 12px; margin: 8px 0 4px; opacity: 0.8; }
  input, select {
    width: 100%; box-sizing: border-box;
    padding: 6px 8px; font-size: 13px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #444);
    border-radius: 3px;
    outline: none;
  }
  input:focus, select:focus {
    border-color: var(--vscode-focusBorder);
  }
  button {
    width: 100%; margin-top: 16px; padding: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 3px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  #status {
    margin-top: 12px; font-size: 12px; padding: 8px;
    background: var(--vscode-editor-background);
    border-radius: 3px; min-height: 60px;
    white-space: pre-wrap; line-height: 1.5;
    display: none;
    max-height: 300px;
    overflow-y: auto;
  }
  #status.visible { display: block; }
  .error { color: var(--vscode-errorForeground); }
  .success { color: var(--vscode-testing-iconPassed); }
  .radio-group { display: flex; gap: 12px; margin-top: 4px; }
  .radio-group label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  .radio-group input { width: auto; }
  .divider { border-top: 1px solid var(--vscode-widget-border, #333); margin: 16px 0; }
  #apiStatus {
    font-size: 11px; padding: 6px 8px; margin-bottom: 12px;
    border-radius: 3px; cursor: pointer;
  }
  #apiStatus.connected {
    background: rgba(0, 200, 83, 0.1);
    border: 1px solid rgba(0, 200, 83, 0.3);
    color: var(--vscode-testing-iconPassed);
  }
  #apiStatus.disconnected {
    background: rgba(255, 152, 0, 0.1);
    border: 1px solid rgba(255, 152, 0, 0.3);
    color: var(--vscode-editorWarning-foreground, #ff9800);
  }
  .phase-label {
    font-size: 10px;
    opacity: 0.5;
    margin-top: 4px;
    display: block;
  }
</style>
</head>
<body>
  <h2>Company Dossier</h2>

  <div id="apiStatus" class="disconnected" onclick="openSettings()">
    AI Analysis: No API key configured. Click to add.
  </div>

  <p style="font-size:11px;opacity:0.7;margin:0 0 12px;">
    Deep research pipeline: website crawl, Wayback Machine, DNS recon, tech stack, public search, and AI analysis.
  </p>

  <label for="name">Company Name</label>
  <input type="text" id="name" placeholder="e.g., Acme Corp" />

  <label for="url">Website URL</label>
  <input type="text" id="url" placeholder="https://acme.com" />

  <label>Research Depth</label>
  <div class="radio-group">
    <label><input type="radio" name="depth" value="quick" /> Quick</label>
    <label><input type="radio" name="depth" value="standard" checked /> Standard</label>
    <label><input type="radio" name="depth" value="deep" /> Deep</label>
  </div>
  <span class="phase-label">Quick: ~30s | Standard: ~2min | Deep: ~5min</span>

  <button id="btn" onclick="startResearch()">Generate Dossier</button>

  <div id="status"></div>

  <script>
    const vscode = acquireVsCodeApi();

    function startResearch() {
      const name = document.getElementById('name').value.trim();
      const url = document.getElementById('url').value.trim();
      const depth = document.querySelector('input[name="depth"]:checked')?.value || 'standard';

      if (!name || !url) { addStatus('Please fill in both fields.', 'error'); return; }
      if (!url.startsWith('http')) { addStatus('URL must start with http:// or https://', 'error'); return; }

      document.getElementById('btn').disabled = true;
      document.getElementById('btn').textContent = 'Researching...';
      document.getElementById('status').className = 'visible';
      document.getElementById('status').innerHTML = '';

      vscode.postMessage({ type: 'research', companyName: name, url: url, depth: depth });
    }

    function openSettings() {
      vscode.postMessage({ type: 'openSettings' });
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'status') { addStatus(msg.text); }
      if (msg.type === 'complete') {
        addStatus(msg.text, 'success');
        if (msg.errors?.length) {
          addStatus('\\nWarnings:', 'error');
          msg.errors.forEach(e => addStatus('  ' + e, 'error'));
        }
        document.getElementById('btn').disabled = false;
        document.getElementById('btn').textContent = 'Generate Another';
      }
      if (msg.type === 'error') {
        addStatus('Error: ' + msg.text, 'error');
        document.getElementById('btn').disabled = false;
        document.getElementById('btn').textContent = 'Generate Dossier';
      }
      if (msg.type === 'apiKeyStatus') {
        const el = document.getElementById('apiStatus');
        if (msg.hasKey) {
          el.className = 'connected';
          el.textContent = 'AI Analysis: Enabled (API key configured)';
        } else {
          el.className = 'disconnected';
          el.textContent = 'AI Analysis: No API key configured. Click to add.';
        }
      }
    });

    function addStatus(text, cls) {
      const el = document.getElementById('status');
      const line = document.createElement('div');
      line.textContent = text;
      if (cls) line.className = cls;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
  </script>
</body>
</html>`;
  }
}

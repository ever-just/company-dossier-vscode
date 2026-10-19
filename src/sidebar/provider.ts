import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runResearch, ResearchInput, FindingsCounts } from '../agent';

export class DossierSidebarProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'companyDossier.sidebar';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _log?: vscode.LogOutputChannel
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('companyDossier.anthropicApiKey') || e.affectsConfiguration('companyDossier.maxPages')) {
        this._sendMessage({
          type: 'settingsUpdate',
          hasKey: !!this._getApiKey(),
          maxPages: this._getMaxPages()
        });
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'research') {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
          this._sendMessage({ type: 'error', text: 'Open a workspace folder first.' });
          return;
        }

        const apiKey = this._getApiKey();

        // Pass the raw input through — agent.ts normalizeTarget() handles any
        // format (with/without https, with/without www, paths, query strings).
        const url = (message.url || '').trim();

        const config = vscode.workspace.getConfiguration('companyDossier');
        const input: ResearchInput = {
          companyName: message.companyName,
          url,
          depth: message.depth || 'standard',
          apiKey: apiKey || undefined,
          model: config.get<string>('model', 'claude-haiku-4-5'),
          focusText: message.focusText || undefined,
          socialPull: config.get<boolean>('socialPull', true),
          socialMaxPosts: config.get<number>('socialMaxPosts', 20),
          socialDownloadMedia: config.get<boolean>('socialDownloadMedia', false),
        };

        this._sendMessage({ type: 'researchStarted', hasApiKey: !!apiKey });

        this._log?.info(`Research started: "${input.companyName}" <${input.url}> depth=${input.depth} model=${input.model} apiKey=${apiKey ? 'set' : 'MISSING'}`);

        try {
          const result = await runResearch(input, root, (msg) => {
            this._log?.appendLine(msg);
            this._sendMessage({ type: 'status', text: msg });
          }, (counts) => {
            this._sendMessage({
              type: 'counts',
              people: counts.people,
              products: counts.products,
              caseStudies: counts.caseStudies,
              partners: counts.partners,
              emails: counts.emails,
              phones: counts.phones,
              socialProfiles: counts.socialProfiles,
              govContracts: counts.govContracts,
            });
          }, (socialStatuses) => {
            this._sendMessage({
              type: 'socialStatuses',
              statuses: socialStatuses.map(s => ({
                platform: s.platform,
                handle: s.handle,
                status: s.status,
                itemCount: s.itemCount,
                detail: s.detail,
              })),
            });
          }, (stageEvent) => {
            // True, event-driven pipeline progress.
            this._sendMessage({ type: 'stage', event: stageEvent });
          });

          const syn = result.llmSynthesis;
          this._sendMessage({
            type: 'complete',
            filesCreated: result.filesCreated,
            hasAI: !!syn,
            errors: result.errors,
            path: result.dossierPath,
            entityType: syn?.entityType || '',
            oneLiner: syn?.oneLiner || '',
            sections: syn?.sections?.length || 0,
            sources: syn?.sources?.length || 0,
            searches: syn?.searches || 0,
            trust: syn?.trust || '',
            cost: syn?.costUSD || 0,
          });

          // Open dossier README
          const readmePath = path.join(result.dossierPath, 'README.md');
          if (fs.existsSync(readmePath)) {
            const doc = await vscode.workspace.openTextDocument(readmePath);
            await vscode.window.showTextDocument(doc);
          }

        } catch (err: any) {
          this._log?.error(`Research failed: ${err?.stack || err?.message || err}`);
          this._sendMessage({ type: 'error', text: err.message });
        }
      }

      if (message.type === 'openSettings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'companyDossier');
      }

      if (message.type === 'showLogs') {
        this._log?.show(true);
      }

      if (message.type === 'saveApiKey') {
        const key = (message.key || '').trim();
        try {
          // Global target so the key persists across all workspaces.
          await vscode.workspace.getConfiguration('companyDossier')
            .update('anthropicApiKey', key, vscode.ConfigurationTarget.Global);
          // Read it back to confirm it actually persisted.
          const saved = this._getApiKey();
          const ok = saved === key && key.length > 0;
          this._log?.info(`Save API key: input length=${key.length}, persisted length=${saved.length}, ok=${ok}`);
          this._sendMessage({ type: 'apiKeySaved', ok, length: saved.length });
          this._sendMessage({ type: 'settingsUpdate', hasKey: !!saved, maxPages: this._getMaxPages() });
        } catch (err: any) {
          this._log?.error(`Save API key FAILED: ${err?.message || err}`);
          this._sendMessage({ type: 'apiKeySaved', ok: false, error: err?.message || String(err) });
        }
      }
    });

    // Send initial state
    this._sendMessage({
      type: 'settingsUpdate',
      hasKey: !!this._getApiKey(),
      maxPages: this._getMaxPages()
    });
  }

  private _getApiKey(): string {
    return vscode.workspace.getConfiguration('companyDossier').get<string>('anthropicApiKey', '');
  }

  private _getMaxPages(): number {
    return vscode.workspace.getConfiguration('companyDossier').get<number>('maxPages', 50);
  }

  private _sendMessage(message: any): void {
    this._view?.webview.postMessage(message);
  }

  private _getHtml(): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
:root{--b:var(--vscode-widget-border,rgba(255,255,255,.12));--mut:var(--vscode-descriptionForeground);--acc:var(--vscode-textLink-foreground,#4fc1ff);--ok:#3fb950;--bad:var(--vscode-errorForeground,#f85149);}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:12px;line-height:1.5;padding:12px;}
h2{font-size:13px;font-weight:700;}
.sub{color:var(--mut);font-size:11px;}
label{display:block;font-size:11px;color:var(--mut);margin:10px 0 4px;}
input[type=text]{width:100%;padding:7px 9px;border:1px solid var(--b);border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font-size:12px;font-family:inherit;}
.btn{width:100%;margin-top:12px;padding:8px;border:none;border-radius:6px;background:var(--acc);color:#fff;font-weight:600;cursor:pointer;font-size:12px;}
.btn:disabled{opacity:.5;cursor:default;}
.btn.ghost{background:transparent;border:1px solid var(--b);color:var(--vscode-foreground);}
.card{border:1px solid var(--b);border-radius:8px;padding:10px;margin-top:12px;}
.hidden{display:none;}
.row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;}
.ic{width:16px;text-align:center;flex:0 0 16px;}
.ic.pending{color:var(--mut);}.ic.active{color:var(--acc);}.ic.done{color:var(--ok);}.ic.failed{color:var(--bad);}
.det{color:var(--mut);font-size:11px;margin-left:auto;text-align:right;}
.agents{margin-left:22px;border-left:1px solid var(--b);padding-left:8px;}
.metrics{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-top:10px;}
.metric{border:1px solid var(--b);border-radius:6px;padding:6px 4px;text-align:center;}
.metric .v{font-size:14px;font-weight:700;}.metric .k{color:var(--mut);font-size:9px;text-transform:uppercase;letter-spacing:.4px;}
.banner{font-size:11px;padding:6px 8px;border-radius:6px;margin:10px 0;}
.banner.ok{background:rgba(63,185,80,.12);color:var(--ok);}.banner.warn{background:rgba(248,81,73,.12);color:var(--bad);}
.log{font-family:var(--vscode-editor-font-family,monospace);font-size:10px;color:var(--mut);max-height:160px;overflow:auto;white-space:pre-wrap;margin-top:6px;}
.kv{display:flex;gap:8px;align-items:center;font-size:12px;}
a{color:var(--acc);}
.spin{display:inline-block;animation:sp 1s linear infinite;}@keyframes sp{to{transform:rotate(360deg);}}
.sechead{font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--mut);margin:16px 0 4px;cursor:pointer;}
</style></head><body>

<h2>Company Dossier</h2>
<div class="sub">AI web-research intelligence dossiers</div>

<div id="apiBanner" class="banner warn">No API key — add one in Settings below.</div>

<div id="form">
  <label>Company / entity name</label>
  <input type="text" id="name" placeholder="e.g. Acme Corp" />
  <label>Website &mdash; any format (https / www optional)</label>
  <input type="text" id="url" placeholder="acme.com" />
  <label>Focus (optional)</label>
  <input type="text" id="focus" placeholder="e.g. pricing, funding, leadership" />
  <div id="formMsg" class="sub" style="color:var(--bad);margin-top:4px;min-height:13px;"></div>
  <button class="btn" id="go" onclick="go()">Generate dossier</button>
</div>

<div id="pipeline" class="card hidden">
  <div id="rows"></div>
  <div class="metrics">
    <div class="metric"><div class="v" id="m-tok">0</div><div class="k">tokens</div></div>
    <div class="metric"><div class="v" id="m-src">0</div><div class="k">sources</div></div>
    <div class="metric"><div class="v" id="m-sea">0</div><div class="k">searches</div></div>
    <div class="metric"><div class="v" id="m-cost">$0.00</div><div class="k">est cost</div></div>
  </div>
</div>

<div id="result" class="card hidden"></div>

<div class="sechead" onclick="toggleLog()">Activity log</div>
<div id="log" class="log hidden"></div>

<div class="sechead">Settings</div>
<div id="apiSaved" class="kv hidden"><span style="color:var(--ok)">&#10003; API key saved</span><button class="btn ghost" style="width:auto;margin:0;padding:3px 10px;" onclick="changeKey()">Change</button></div>
<div id="apiInput">
  <label>Anthropic API key</label>
  <input type="text" id="key" placeholder="sk-ant-..." />
  <div id="keyFb" style="font-size:11px;margin-top:4px;min-height:13px;"></div>
  <button class="btn" onclick="saveKey()">Save key</button>
</div>
<button class="btn ghost" style="margin-top:10px;" onclick="showLogs()">Open Dev Logs</button>
<div class="sub" style="margin-top:6px;">Model in VS Code Settings &rarr; Company Dossier (default: Haiku, cheapest).</div>

<script>
var vscode=acquireVsCodeApi();
var STAGES=[['collect','Collecting site data'],['research','Researching the web'],['synthesize','Synthesizing brief & analysis'],['verify','Verifying & fact-checking'],['generate','Writing dossier files']];
var ICON={pending:'○',active:'◐',done:'✓',failed:'✗'};
function el(id){return document.getElementById(id);}
function fmt(n){return n>=1000?(n/1000).toFixed(n>=10000?0:1)+'k':String(n);}
function addLog(t){var l=el('log');var d=document.createElement('div');d.textContent=t;l.appendChild(d);l.scrollTop=l.scrollHeight;}
function toggleLog(){el('log').classList.toggle('hidden');}
function showLogs(){vscode.postMessage({type:'showLogs'});}
function changeKey(){el('apiSaved').classList.add('hidden');el('apiInput').classList.remove('hidden');}
function save(){vscode.setState({name:el('name').value,url:el('url').value,focus:el('focus').value});}
function go(){
  var name=el('name').value.trim(),url=el('url').value.trim(),focus=el('focus').value.trim();
  el('formMsg').textContent='';
  if(!name){el('formMsg').textContent='Enter a company / entity name.';return;}
  if(!url){el('formMsg').textContent='Enter a website (any format).';return;}
  save();
  el('go').disabled=true;el('go').textContent='Researching…';
  el('result').classList.add('hidden');el('result').innerHTML='';
  el('pipeline').classList.remove('hidden');el('log').innerHTML='';
  buildRows();setMetrics(0,0,0,0);
  vscode.postMessage({type:'research',companyName:name,url:url,depth:'deep',focusText:focus});
}
function buildRows(){
  var h='';
  for(var i=0;i<STAGES.length;i++){
    var s=STAGES[i];
    h+='<div class="row"><span class="ic pending" id="ic-'+s[0]+'">'+ICON.pending+'</span><span>'+s[1]+'</span><span class="det" id="det-'+s[0]+'"></span></div>';
    if(s[0]==='research'){h+='<div class="agents" id="agents"></div>';}
  }
  el('rows').innerHTML=h;
}
function setStage(stage,status,detail){
  var ic=el('ic-'+stage);if(!ic)return;
  ic.className='ic '+status+(status==='active'?' spin':'');ic.textContent=ICON[status]||ICON.pending;
  if(detail){el('det-'+stage).textContent=detail;}
}
function setAgent(id,label,status,detail){
  var row=el('ag-'+id);
  if(!row){var c=el('agents');if(!c)return;row=document.createElement('div');row.className='row';row.id='ag-'+id;
    row.innerHTML='<span class="ic" id="agic-'+id+'"></span><span>'+label+'</span><span class="det" id="agdet-'+id+'"></span>';c.appendChild(row);}
  var ic=el('agic-'+id);ic.className='ic '+status+(status==='running'?' active spin':'');
  ic.textContent=(status==='running')?ICON.active:(status==='done'?ICON.done:status==='failed'?ICON.failed:ICON.pending);
  if(detail){el('agdet-'+id).textContent=detail;}
}
function setMetrics(tok,src,sea,cost){el('m-tok').textContent=fmt(tok);el('m-src').textContent=src;el('m-sea').textContent=sea;el('m-cost').textContent='$'+cost.toFixed(2);}
function saveKey(){var k=el('key').value.trim();if(!k){el('keyFb').textContent='Enter a key first.';return;}el('keyFb').textContent='Saving…';vscode.postMessage({type:'saveApiKey',key:k});}
function apiState(hasKey){
  if(hasKey){el('apiSaved').classList.remove('hidden');el('apiInput').classList.add('hidden');el('apiBanner').className='banner ok';el('apiBanner').textContent='AI research ready.';}
  else{el('apiSaved').classList.add('hidden');el('apiInput').classList.remove('hidden');el('apiBanner').className='banner warn';el('apiBanner').textContent='No API key — add one in Settings below.';}
}
window.addEventListener('message',function(e){
  var m=e.data;
  if(m.type==='status'){addLog(m.text);}
  else if(m.type==='stage'){var ev=m.event;
    if(ev.type==='stage'){setStage(ev.stage,ev.status,ev.detail);}
    else if(ev.type==='agent'){setAgent(ev.id,ev.label,ev.status,ev.detail);}
    else if(ev.type==='metrics'){setMetrics((ev.input||0)+(ev.output||0),ev.sources,ev.searches,ev.cost);}
  }
  else if(m.type==='complete'){
    el('go').disabled=false;el('go').textContent='Generate another';
    var r=el('result');r.classList.remove('hidden');
    if(m.hasAI){
      r.innerHTML='<div style="font-weight:700;margin-bottom:2px;">'+(m.entityType||'Dossier')+' — '+m.sections+' sections</div>'
        +(m.oneLiner?'<div class="sub" style="margin-bottom:6px;">'+m.oneLiner+'</div>':'')
        +'<div class="metrics"><div class="metric"><div class="v">'+m.sections+'</div><div class="k">sections</div></div>'
        +'<div class="metric"><div class="v">'+m.sources+'</div><div class="k">sources</div></div>'
        +'<div class="metric"><div class="v">'+(m.trust||'n/a')+'</div><div class="k">trust</div></div>'
        +'<div class="metric"><div class="v">$'+(m.cost||0).toFixed(2)+'</div><div class="k">cost</div></div></div>'
        +'<div class="sub" style="margin-top:8px;">'+m.filesCreated+' files created · README opening…</div>';
    }else{
      r.innerHTML='<div style="color:var(--bad);font-weight:600;">AI research did not run.</div><div class="sub">Open Dev Logs for the exact reason (usually no API key or no credits).</div>';
    }
    if(m.errors&&m.errors.length){addLog(m.errors.length+' warning(s) — see above.');}
  }
  else if(m.type==='error'){el('go').disabled=false;el('go').textContent='Generate dossier';addLog('Error: '+m.text);el('formMsg').textContent=m.text;}
  else if(m.type==='apiKeySaved'){if(m.ok){el('keyFb').textContent='';el('key').value='';apiState(true);}else{el('keyFb').textContent='Save failed'+(m.error?': '+m.error:'')+' — see Dev Logs.';}}
  else if(m.type==='settingsUpdate'){apiState(!!m.hasKey);}
});
(function(){var s=vscode.getState();if(s){if(s.name)el('name').value=s.name;if(s.url)el('url').value=s.url;if(s.focus)el('focus').value=s.focus;}})();
['name','url','focus'].forEach(function(id){var x=el(id);if(x){x.addEventListener('input',save);}});
</script>
</body></html>`;
  }
}

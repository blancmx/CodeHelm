import path from 'node:path';
import type { RunProfile } from '@codehelm/domain';
import type { RunnerExecutionMode } from '@codehelm/contracts';
import type { DependencyInstallPlan } from './ipc/dependency-installer.js';
import { quoteWindowsArgument } from './windows-app-details.js';

export interface ExecutionReview {
  projectRoot: string;
  profile: RunProfile;
  mode: RunnerExecutionMode;
  plans: DependencyInstallPlan[];
  theme?: 'dark' | 'light';
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);

// Only escaped text enters this document. No project HTML, URLs or scripts run here.
export function renderExecutionReview(review: ExecutionReview, nonce: string): string {
  const { profile, projectRoot, mode, plans } = review;
  const secrets = profile.services.flatMap(s => s.env.filter(e => e.isSecret && e.value).map(e => e.value))
    .sort((a, b) => b.length - a.length);
  const text = (value: string) => escapeHtml(secrets.reduce((s, secret) => s.split(secret).join('••••'), value));
  const command = (exe: string, args: string[]) => text([exe, ...args].map(arg =>
    !arg || /\s|"/.test(arg) ? quoteWindowsArgument(arg) : arg).join(' '));
  const services = profile.services.filter(s => s.enabled);
  const title = mode === 'install' ? '安装并启动确认' : '启动确认';
  const rows = services.map(s => `<section class="service">
    <div class="service-heading"><h2>${text(s.name)}</h2><span class="port">${s.port ? `端口 ${s.port}${s.portMode === 'auto' ? ' · 可自动分配' : ''}` : '未指定端口'}</span></div>
    <pre><span class="prompt">$</span> ${command(s.executable, s.args)}</pre>
    <dl><dt>工作目录</dt><dd>${text(path.resolve(projectRoot, s.cwdRelative || '.'))}</dd>
    <dt>环境变量</dt><dd>${s.env.length ? s.env.map(e => `${text(e.key)}=${e.isSecret ? '••••' : text(e.value)}`).join('<br>') : '无额外配置（继承应用环境）'}</dd></dl>
  </section>`).join('');
  const installs = mode === 'install' ? `<section class="install"><h2>依赖安装计划</h2><p>将先执行下列计划，可能联网下载依赖并运行安装脚本。</p>${plans.length
    ? plans.map(p => `<pre>${command(p.executable, p.args)}</pre><p class="path">${text(p.cwd)}${p.pythonModuleCheck ? '<br>仅在检测到依赖缺失时安装' : ''}</p>`).join('')
    : '<p>当前未发现需要安装的依赖。</p>'}</section>` : '';
  return `<!doctype html><html lang="zh-CN" data-theme="${review.theme === 'light' ? 'light' : 'dark'}"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'nonce-${escapeHtml(nonce)}'; base-uri 'none'; form-action 'none'; frame-src 'none'">
  <title>CodeHelm · ${title}</title><style nonce="${escapeHtml(nonce)}">
  :root{color-scheme:dark;--bg:#121216;--card:#18181b;--code:#09090b;--line:#303036;--text:#fafafa;--muted:#a1a1aa;--action:#fafafa;--action-text:#18181b}
  :root[data-theme=light]{color-scheme:light;--bg:#fafafa;--card:#fff;--code:#f0f0f2;--line:#d4d4d8;--text:#18181b;--muted:#60606a;--action:#18181b;--action-text:#fff}
  *{box-sizing:border-box}html,body{height:100%;margin:0}body{font:14px/1.6 'Segoe UI','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--text);display:flex;flex-direction:column;border:1px solid var(--line)}
  header{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid var(--line);-webkit-app-region:drag}h1{font-size:19px;margin:0;font-weight:650}h2{font-size:14px;margin:0;font-weight:600}.brand{font-size:11px;color:var(--muted);letter-spacing:.12em}
  button{font:inherit;border:1px solid var(--line);border-radius:8px;padding:9px 17px;cursor:pointer;background:var(--card);color:var(--text);-webkit-app-region:no-drag}button:hover{filter:brightness(.9)}button:focus-visible{outline:2px solid var(--text);outline-offset:3px}button:disabled{opacity:.5;cursor:wait}.close{border:0;background:transparent;font-size:24px;padding:0 7px;line-height:1.4}
  main{flex:1;min-height:0;overflow:auto;padding:22px 24px}.summary{margin-bottom:18px}.summary p{margin:5px 0;color:var(--muted)}.path,dd,pre{font-family:Consolas,'Cascadia Mono',monospace;overflow-wrap:anywhere}.path{font-size:12px;color:var(--muted)}.scope{display:inline-block;font-size:12px;padding:3px 9px;background:var(--card);border:1px solid var(--line);border-radius:5px;margin-bottom:8px}
  .service,.install{border:1px solid var(--line);border-radius:10px;background:var(--card);padding:16px;margin-top:12px}.service-heading{display:flex;justify-content:space-between;align-items:baseline;gap:16px}.port{font-size:12px;color:var(--muted);flex-shrink:0}pre{white-space:pre-wrap;word-break:break-word;background:var(--code);padding:12px;border-radius:6px;font-size:12px;margin:12px 0}.prompt{color:var(--muted)}dl{display:grid;grid-template-columns:65px minmax(0,1fr);gap:6px 12px;margin:0;font-size:12px}dt{color:var(--muted)}dd{margin:0}.install p{font-size:12px;color:var(--muted)}
  footer{border-top:1px solid var(--line);padding:16px 24px;display:flex;align-items:center;gap:12px}footer p{flex:1;font-size:12px;color:var(--muted);margin:0}.primary{background:var(--action);color:var(--action-text);border-color:var(--action);font-weight:600}.note{font-size:12px;color:var(--muted);margin:16px 0 0} @media(max-width:620px){footer{flex-wrap:wrap}footer p{flex-basis:100%}.service-heading{flex-wrap:wrap;gap:4px}}
  </style></head><body><header><div><div class="brand">CODEHELM</div><h1>${title}</h1></div><button class="close" id="close" aria-label="关闭确认窗口">×</button></header>
  <main><div class="summary"><span class="scope">${mode === 'install' ? '安装依赖，然后启动' : '仅启动服务 · 不安装依赖'}</span><h2>${text(profile.name)} · ${services.length} 个服务</h2><p class="path">${text(projectRoot)}</p><p>请核对本次执行内容。确认后直接启动，无需再次确认。</p></div>
  ${rows}${installs}<p class="note">服务按依赖关系启动。{{PORT}} 会按所示端口策略替换。需要修改参数？取消后前往「启动配置」。</p></main>
  <footer><p>相同配置在本次应用会话内可直接启动；<br>执行内容变化后需重新确认。</p><button id="cancel">取消</button><button id="approve" class="primary"${services.length ? '' : ' disabled'}>${mode === 'install' ? '确认安装并启动' : '确认并启动'}</button></footer></body></html>`;
}

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import naive from 'naive-ui';
import App from './App.vue';
import router from './router/index.js';

// UnoCSS: Reset MUST be imported before virtual:uno.css
import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';

function showBridgeInitializationError(): void {
  const root = document.querySelector('#app');
  if (!root) return;

  const panel = document.createElement('main');
  panel.setAttribute('role', 'alert');
  panel.className = 'min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-8';

  const content = document.createElement('section');
  content.className = 'max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl';

  const title = document.createElement('h1');
  title.className = 'text-lg font-bold';
  title.textContent = 'CodeHelm 初始化失败';

  const message = document.createElement('p');
  message.className = 'mt-3 text-sm leading-6 text-zinc-300';
  message.textContent = '桌面安全桥未能加载。请关闭 CodeHelm 后重新启动；若问题持续，请保留日志并联系维护人员。';

  content.append(title, message);
  panel.append(content);
  root.replaceChildren(panel);
}

async function ensureCodeHelmApi(): Promise<boolean> {
  if (window.codehelm) return true;

  if (import.meta.env.DEV) {
    const { setupBrowserMock } = await import('./utils/browserMock.js');
    setupBrowserMock();
    return Boolean(window.codehelm);
  }

  showBridgeInitializationError();
  return false;
}

async function bootstrap(): Promise<void> {
  if (!(await ensureCodeHelmApi())) return;

  const app = createApp(App);
  app.config.errorHandler = (err, _instance, info) => {
    console.error('[Vue Error]:', err, info);
  };

  app.use(createPinia());
  app.use(router);
  app.use(naive);
  app.mount('#app');
}

void bootstrap();

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import naive from 'naive-ui';
import App from './App.vue';
import router from './router/index.js';
import { setupBrowserMock } from './utils/browserMock.js';

// If running in a regular web browser (outside Electron), initialize mock engine
if (!window.codehelm) {
  setupBrowserMock();
}

// UnoCSS: Reset MUST be imported before virtual:uno.css
import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';

const app = createApp(App);
app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue Error]:', err, info);
};

app.use(createPinia());
app.use(router);
app.use(naive);

app.mount('#app');

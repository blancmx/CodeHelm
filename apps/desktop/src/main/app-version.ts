import manifest from '../../package.json';
// Electron launched with a JS entry reports its own version via app.getVersion().
export const CODEHELM_APP_VERSION=manifest.version;

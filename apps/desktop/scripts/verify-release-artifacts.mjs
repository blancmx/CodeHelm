import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBuilderRequire = createRequire(require.resolve('electron-builder/package.json'));
const { extractFile, listPackage } = electronBuilderRequire('@electron/asar');

const resourcesDir = path.resolve(process.argv[2] ?? 'dist-release/win-unpacked/resources');
const asarPath = path.join(resourcesDir, 'app.asar');

if (!fs.existsSync(asarPath) || !fs.statSync(asarPath).isFile()) {
  throw new Error(`Release ASAR not found: ${asarPath}`);
}

const entries = listPackage(asarPath).map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, ''));
const entrySet = new Set(entries);

const requiredEntries = [
  'node_modules/better-sqlite3/package.json',
  'node_modules/better-sqlite3/lib/index.js',
  'node_modules/better-sqlite3/prebuilds/win32-x64.node',
  'node_modules/@codehelm/safe-fs/package.json',
  'node_modules/@codehelm/safe-fs/index.js',
  'node_modules/@codehelm/safe-fs/build/Release/codehelm_safe_fs.node',
];

for (const requiredEntry of requiredEntries) {
  if (!entrySet.has(requiredEntry)) throw new Error(`Required runtime entry missing: ${requiredEntry}`);
}

function isAllowedNativeEntry(entry) {
  const allowedDirectory = [
    'node_modules/better-sqlite3/lib',
    'node_modules/better-sqlite3/prebuilds',
    'node_modules/@codehelm/safe-fs/build',
    'node_modules/@codehelm/safe-fs/build/Release',
  ].includes(entry);
  if (allowedDirectory) return true;
  if (entry === 'node_modules/better-sqlite3/package.json' || entry === 'node_modules/better-sqlite3/LICENSE') return true;
  if (entry.startsWith('node_modules/better-sqlite3/lib/')) return true;
  if (entry === 'node_modules/better-sqlite3/prebuilds/win32-x64.node') return true;
  if (entry === 'node_modules/@codehelm/safe-fs/package.json' || entry === 'node_modules/@codehelm/safe-fs/index.js') return true;
  return entry === 'node_modules/@codehelm/safe-fs/build/Release/codehelm_safe_fs.node';
}

const nativePrefixes = ['node_modules/better-sqlite3/', 'node_modules/@codehelm/safe-fs/'];
const unexpectedNativeEntries = entries.filter(
  (entry) => nativePrefixes.some((prefix) => entry.startsWith(prefix)) && !isAllowedNativeEntry(entry),
);
if (unexpectedNativeEntries.length > 0) {
  throw new Error(`Unexpected native dependency entries:\n${unexpectedNativeEntries.join('\n')}`);
}

const buildOnlyEntries = entries.filter((entry) => entry.startsWith('node_modules/node-addon-api/'));
if (buildOnlyEntries.length > 0) {
  throw new Error(`Build-only node-addon-api entries were packaged:\n${buildOnlyEntries.join('\n')}`);
}

function listFilesRecursively(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(rootDir, entry.name);
    return entry.isDirectory() ? listFilesRecursively(absolutePath) : [absolutePath];
  });
}

const unpackedDir = `${asarPath}.unpacked`;
const unpackedFiles = listFilesRecursively(unpackedDir)
  .map((filePath) => path.relative(unpackedDir, filePath).replaceAll('\\', '/'))
  .sort();
const requiredUnpackedFiles = [
  'node_modules/@codehelm/safe-fs/build/Release/codehelm_safe_fs.node',
  'node_modules/better-sqlite3/prebuilds/win32-x64.node',
];

const unexpectedUnpackedFiles = unpackedFiles.filter(
  (entry) => !entrySet.has(entry) || !isAllowedNativeEntry(entry),
);
if (unexpectedUnpackedFiles.length > 0) {
  throw new Error(`Unexpected unpacked runtime files:\n${unexpectedUnpackedFiles.join('\n')}`);
}

for (const unpackedFile of requiredUnpackedFiles) {
  if (!unpackedFiles.includes(unpackedFile)) {
    throw new Error(`Required unpacked native binary missing: ${unpackedFile}`);
  }
}

for (const unpackedFile of unpackedFiles) {
  const absolutePath = path.join(unpackedDir, ...unpackedFile.split('/'));
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) {
    throw new Error(`Unpacked runtime file missing or empty: ${unpackedFile}`);
  }
}

const desktopDir = path.resolve('apps/desktop');
for (const outputDirName of ['dist', 'dist-electron']) {
  const outputDir = path.join(desktopDir, outputDirName);
  for (const outputFile of listFilesRecursively(outputDir)) {
    const relativeOutputPath = path.relative(desktopDir, outputFile).replaceAll('\\', '/');
    if (!entrySet.has(relativeOutputPath)) throw new Error(`Current build output missing from ASAR: ${relativeOutputPath}`);
    const packagedBytes = extractFile(asarPath, relativeOutputPath.replaceAll('/', path.sep));
    if (!packagedBytes.equals(fs.readFileSync(outputFile))) {
      throw new Error(`Packaged output is stale: ${relativeOutputPath}`);
    }
  }
}

const forbiddenMarkers = [
  'codehelm_browser_mock_projects_v5',
  'E:/Aai/AllProject/desk',
  'E:/projects/',
  'C:\\Users\\ASUS',
  'E:\\Aai\\AllProject\\desk',
];
const asarBytes = fs.readFileSync(asarPath);
for (const marker of forbiddenMarkers) {
  if (asarBytes.includes(Buffer.from(marker))) throw new Error(`Forbidden production marker found: ${marker}`);
}

console.log(`Release artifact verification passed (${entries.length} ASAR entries).`);

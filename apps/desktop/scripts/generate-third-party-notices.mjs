import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..', '..', '..');
const sourceRoots = [path.join(root, 'apps', 'desktop', 'src'), path.join(root, 'packages')];
const workspaceDirs = [
  path.join(root, 'apps', 'desktop'),
  ...fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, 'packages', entry.name)),
  root,
];
const sourceExtensions = new Set(['.ts', '.js', '.mjs', '.vue']);
const ignoredSegments = new Set(['__tests__', 'test', 'tests', 'dist', 'build', 'node_modules']);
const importPatterns = [
  /^\s*import\s+(?!type\b)(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/gm,
  /^\s*export\s+(?!type\b)[^'"\n]+?\s+from\s+['"]([^'"]+)['"]/gm,
];
const upstreamLicenseDir = path.join(root, 'apps', 'desktop', 'resources', 'third-party-license-overrides');
const upstreamLicenseSources = JSON.parse(fs.readFileSync(path.join(upstreamLicenseDir, 'sources.json'), 'utf8'));

const packageIndex = new Map();
const pnpmModules = path.join(root, 'node_modules', '.pnpm');
for (const storeEntry of fs.readdirSync(pnpmModules, { withFileTypes: true })) {
  if (!storeEntry.isDirectory()) continue;
  const modulesPath = path.join(pnpmModules, storeEntry.name, 'node_modules');
  if (!fs.existsSync(modulesPath)) continue;
  for (const entry of fs.readdirSync(modulesPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidatePaths = entry.name.startsWith('@')
      ? fs.readdirSync(path.join(modulesPath, entry.name), { withFileTypes: true })
          .filter((child) => child.isDirectory())
          .map((child) => path.join(modulesPath, entry.name, child.name))
      : [path.join(modulesPath, entry.name)];
    for (const candidatePath of candidatePaths) {
      const manifestPath = path.join(candidatePath, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const candidates = packageIndex.get(manifest.name) ?? [];
        candidates.push({ root: fs.realpathSync(candidatePath), manifest, manifestPath });
        packageIndex.set(manifest.name, candidates);
      } catch {
        // A malformed package manifest will still fail if it is selected below.
      }
    }
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectSourceFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(fullPath, output);
    else if (sourceExtensions.has(path.extname(entry.name)) && !entry.name.includes('.test.')) output.push(fullPath);
  }
  return output;
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

const importEvidence = new Map();
for (const sourceRoot of sourceRoots) {
  for (const filePath of collectSourceFiles(sourceRoot)) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const importPattern of importPatterns) {
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[1];
        if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') || specifier.startsWith('virtual:')) continue;
        const name = packageName(specifier);
        if (name.startsWith('@codehelm/')) continue;
        const relative = path.relative(root, filePath).replaceAll(path.sep, '/');
        const evidence = importEvidence.get(name) ?? new Set();
        evidence.add(relative);
        importEvidence.set(name, evidence);
      }
    }
  }
}

function findPackageRoot(entryPath, expectedName) {
  let current = fs.statSync(entryPath).isDirectory() ? entryPath : path.dirname(entryPath);
  while (current !== path.dirname(current)) {
    const manifestPath = path.join(current, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === expectedName) return { root: fs.realpathSync(current), manifest, manifestPath };
    }
    current = path.dirname(current);
  }
  throw new Error(`Could not find package root for ${expectedName} from ${entryPath}`);
}

function resolvePackage(name, searchDirs) {
  let lastError;
  for (const searchDir of searchDirs) {
    try {
      const require = createRequire(path.join(searchDir, 'package.json'));
      try {
        return findPackageRoot(require.resolve(`${name}/package.json`), name);
      } catch {
        return findPackageRoot(require.resolve(name), name);
      }
    } catch (error) {
      lastError = error;
    }
  }
  const indexed = packageIndex.get(name) ?? [];
  if (indexed.length === 1) return indexed[0];
  if (indexed.length > 1) {
    const uniqueVersions = new Set(indexed.map((entry) => entry.manifest.version));
    if (uniqueVersions.size === 1) return indexed[0];
    throw new Error(`Ambiguous indexed versions for ${name}: ${[...uniqueVersions].join(', ')}`);
  }
  const storePrefix = `${name.replace('/', '+')}@`;
  const directCandidates = fs.readdirSync(pnpmModules, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(storePrefix))
    .map((entry) => path.join(pnpmModules, entry.name, 'node_modules', ...name.split('/')))
    .filter((candidatePath) => fs.existsSync(path.join(candidatePath, 'package.json')))
    .map((candidatePath) => {
      const manifestPath = path.join(candidatePath, 'package.json');
      return { root: fs.realpathSync(candidatePath), manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath };
    });
  if (directCandidates.length === 1) return directCandidates[0];
  if (directCandidates.length > 1) {
    const uniqueVersions = new Set(directCandidates.map((entry) => entry.manifest.version));
    if (uniqueVersions.size === 1) return directCandidates[0];
    throw new Error(`Ambiguous direct store versions for ${name}: ${[...uniqueVersions].join(', ')}`);
  }
  throw lastError ?? new Error(`Unable to resolve ${name}`);
}

function licenseFiles(packageRoot) {
  return fs.readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice)([._-]|$)/i.test(entry.name))
    .map((entry) => {
      const filePath = path.join(packageRoot, entry.name);
      return { name: entry.name, bytes: fs.statSync(filePath).size, sha256: sha256(filePath), text: fs.readFileSync(filePath, 'utf8') };
    });
}

function effectiveLicenseFiles(packageName, packageVersion, packageRoot) {
  const packagedFiles = licenseFiles(packageRoot).map((file) => ({ ...file, source: 'package' }));
  if (packagedFiles.length > 0) return packagedFiles;
  const override = upstreamLicenseSources[`${packageName}@${packageVersion}`];
  if (!override) return [];
  const filePath = path.join(upstreamLicenseDir, override.file);
  return [{
    name: override.file,
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
    text: fs.readFileSync(filePath, 'utf8'),
    source: 'upstream-override',
    sourceUrl: override.sourceUrl,
    basis: override.basis,
  }];
}

const queue = [...importEvidence.keys()]
  .filter((name) => name !== 'electron')
  .map((name) => ({ name, searchDirs: workspaceDirs, required: true, reason: 'direct-import' }));
const packages = new Map();
const unresolved = [];
while (queue.length > 0) {
  const request = queue.shift();
  const { name } = request;
  try {
    const resolved = resolvePackage(name, request.searchDirs);
    if (packages.has(resolved.root)) continue;
    const files = effectiveLicenseFiles(resolved.manifest.name, resolved.manifest.version, resolved.root);
    const record = {
      name: resolved.manifest.name,
      version: resolved.manifest.version,
      license: resolved.manifest.license ?? null,
      repository: typeof resolved.manifest.repository === 'string'
        ? resolved.manifest.repository
        : resolved.manifest.repository?.url ?? null,
      packageRoot: path.relative(root, resolved.root).replaceAll(path.sep, '/'),
      directImportSources: [...(importEvidence.get(name) ?? [])].sort(),
      licenseFiles: files.map(({ text: _text, ...file }) => file),
    };
    packages.set(resolved.root, record);
    const dependencyRequests = [
      ...Object.keys(resolved.manifest.dependencies ?? {}).map((dependencyName) => ({ name: dependencyName, required: true, reason: `${name}:dependency` })),
      ...Object.keys(resolved.manifest.optionalDependencies ?? {}).map((dependencyName) => ({ name: dependencyName, required: false, reason: `${name}:optionalDependency` })),
      ...Object.keys(resolved.manifest.peerDependencies ?? {}).map((dependencyName) => ({
        name: dependencyName,
        required: resolved.manifest.peerDependenciesMeta?.[dependencyName]?.optional !== true,
        reason: `${name}:peerDependency`,
      })),
    ];
    for (const dependencyRequest of dependencyRequests) {
      if (!dependencyRequest.name.startsWith('@codehelm/')) {
        queue.push({ ...dependencyRequest, searchDirs: [resolved.root, ...workspaceDirs] });
      }
    }
  } catch (error) {
    unresolved.push({ name, required: request.required, reason: request.reason, message: error instanceof Error ? error.message : String(error) });
  }
}

const sortedPackages = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
const missingLicenseMetadata = sortedPackages.filter((entry) => !entry.license).map((entry) => entry.name);
const missingLicenseFiles = sortedPackages.filter((entry) => entry.licenseFiles.length === 0).map((entry) => entry.name);
const restrictedLicenses = sortedPackages
  .filter((entry) => /(AGPL|GPL|LGPL|SSPL|BUSL|Commons Clause)/i.test(String(entry.license)))
  .map((entry) => ({ name: entry.name, version: entry.version, license: entry.license }));

const status = unresolved.filter((entry) => entry.required).length === 0
  && missingLicenseMetadata.length === 0
  && missingLicenseFiles.length === 0
  && restrictedLicenses.length === 0;
const report = {
  status: status ? 'passed' : 'review-required',
  scope: 'non-test runtime imports plus recursively resolvable dependencies; Electron and Chromium notices are verified after packaging',
  directImports: [...importEvidence.entries()].map(([name, sources]) => ({ name, sources: [...sources].sort() })).sort((a, b) => a.name.localeCompare(b.name)),
  packageCount: sortedPackages.length,
  packages: sortedPackages,
  unresolved,
  missingLicenseMetadata,
  missingLicenseFiles,
  restrictedLicenses,
};
const auditOutputIndex = process.argv.indexOf('--audit-output');
if (auditOutputIndex >= 0) {
  const auditOutput = process.argv[auditOutputIndex + 1];
  if (!auditOutput) throw new Error('--audit-output requires a path');
  const auditPath = path.resolve(auditOutput);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(auditPath, `${JSON.stringify(report, null, 2)}\n`);
}

const noticeSections = [];
for (const entry of sortedPackages) {
  const packageRoot = path.resolve(root, entry.packageRoot);
  for (const file of effectiveLicenseFiles(entry.name, entry.version, packageRoot)) {
    noticeSections.push([
      '-'.repeat(78),
      `${entry.name} ${entry.version}`,
      `Declared license: ${entry.license}`,
      `Source: ${entry.repository ?? 'not declared'}`,
      `License file: ${file.name}`,
      `License text source: ${file.sourceUrl ?? 'published package'}`,
      ...(file.basis ? [`Source basis: ${file.basis}`] : []),
      '-'.repeat(78),
      file.text.replace(/[ \t]+$/gm, '').trim(),
      '',
    ].join('\n'));
  }
}
const notice = [
  'CodeHelm Third-Party Software Notices',
  '',
  'Generated from non-test runtime imports and recursively resolved package metadata.',
  'Electron and Chromium notices are distributed separately as LICENSE.electron.txt and LICENSES.chromium.html.',
  '',
  ...noticeSections,
].join('\n');
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notice, 'utf8');
console.log(JSON.stringify({ status: report.status, packageCount: report.packageCount, directImports: report.directImports.map((entry) => entry.name), unresolved, missingLicenseMetadata, missingLicenseFiles, restrictedLicenses }, null, 2));
if (!status) process.exitCode = 1;

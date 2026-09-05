import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.resolve(process.argv[2] ?? 'dist-release');
const artifactNames = [
  'CodeHelm Setup 0.1.0.exe',
  'CodeHelm Setup 0.1.0.exe.blockmap',
  'win-unpacked/CodeHelm.exe',
];

const artifacts = artifactNames.map((name) => {
  const absolutePath = path.join(releaseDir, ...name.split('/'));
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Unsigned release artifact missing: ${absolutePath}`);
  }
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: name,
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  };
});

const checksums = artifacts.map((artifact) => `${artifact.sha256}  *${artifact.path}`).join('\n') + '\n';
fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), checksums, 'utf8');

const notice = `CodeHelm v0.1.0 未签名开发版本 / Unsigned development build

此安装器仅用于开发和内测，未使用 Authenticode 代码签名证书。
Windows SmartScreen 或杀毒软件可能显示“未知发布者”警告。

使用前请通过同目录 SHA256SUMS.txt 核对文件完整性。
请勿将此包描述或分发为已签名的正式生产版本。

This installer is intended for development and internal testing only.
It is not Authenticode signed and must not be represented as a signed production release.
Verify artifact integrity against SHA256SUMS.txt before use.
`;
fs.writeFileSync(path.join(releaseDir, 'UNSIGNED-RELEASE-NOTICE.txt'), notice, 'utf8');

fs.writeFileSync(
  path.join(releaseDir, 'unsigned-release.json'),
  `${JSON.stringify(
    {
      product: 'CodeHelm',
      version: '0.1.0',
      channel: 'development',
      signaturePolicy: 'unsigned',
      generatedAt: new Date().toISOString(),
      artifacts,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`Unsigned release metadata generated for ${artifacts.length} artifacts.`);

import { expect, it } from 'vitest';
import { DiagnosticBundleInputSchema, DIAGNOSTIC_BUNDLE_MAX_BYTES, type RunSessionDto, type StoredLogPage } from '@codehelm/contracts';
import { buildDiagnosticBundle, createBundleRedactor, serializeBundle } from '../diagnostic-bundle.js';

const selection = { runSessionId: '00000000-0000-4000-8000-000000000001', from: '2026-09-12T00:00:00Z', to: '2026-09-13T00:00:00Z' };
const run = { id: selection.runSessionId, projectId: 'private-project', runProfileId: 'private-profile',
  status: 'FAILED', startedAt: selection.from, projectRootPath: 'C:\\Users\\private-user\\project', profileName: 'private-name',
  services: [{ id: 's', runSessionId: selection.runSessionId, serviceConfigId: 'c', serviceName: 'private-name', serviceType: 'tool',
    status: 'FAILED', errorMessage: 'password=private-error', exitCode: 1, fingerprint: { executable: 'private-exe', cwd: 'private-root', argsSummary: 'private-command', pid: 1, startTime: 0 } }],
} as RunSessionDto;
const logs: StoredLogPage = { entries: [{ id: '1', serviceSessionId: 's', serviceName: 'private-name', stream: 'stderr', timestamp: selection.from,
  message: 'Error at C:\\Users\\private-user\\project: private-value' }], snapshotAt: selection.to,
  scannedBytes: 100, missingFiles: 2, skippedRecords: 1, truncatedEntries: 0, fileLimitReached: false, retentionDays: 14, retentionMb: 500, droppedEntries: 0 };

it('excludes names, commands, environment, raw errors, paths and arbitrary metadata', () => {
  const result = buildDiagnosticBundle({ selection, run, version: '0.2.0-rc.1', logs,
    redact: createBundleRedactor(['private-value'], [run.projectRootPath!]), warnings: [] });
  const text = serializeBundle(result.entries, result.warnings);
  for (const secret of ['private-user', 'private-name', 'private-value', 'private-error', 'private-command', 'private-exe', 'private-project']) expect(text).not.toContain(secret);
  expect(text).toContain('SERVICE_ERROR_RECORDED'); expect(text).toContain('[PATH_1]');
  expect(result.warnings.some(w => w.includes('2 个日志文件'))).toBe(true);
});
it('redacts JSON credentials, bearer tokens, URLs, quoted paths and repeated path identities', () => {
  const redact = createBundleRedactor(['raw-secret'], []);
  for (const input of ['{"password": "json-secret"}', 'Bearer jwt-secret', 'https://host/path?key=url-secret', '"C:\\Users\\name with spaces\\file"', '/home/private/file']) {
    const output = redact(input); expect(output).not.toMatch(/secret|Users|private|name with spaces/);
  }
  expect(redact('C:\\folder\\file')).toBe(redact('C:\\folder\\file'));
  expect(redact('x'.repeat(4090) + 'raw-secret')).not.toContain('raw-');
  expect(redact('-----BEGIN PRIVATE KEY-----\nprivate body')).toBe('[PRIVATE_KEY]');
});
it('omits log text when known secrets cannot be read and accurately reports unknown coverage', () => {
  const partial = buildDiagnosticBundle({ selection, run, version: 'v', logs, warnings: [] });
  expect(partial.entries.some(entry => entry.id === 'log-1')).toBe(false);
  expect(partial.warnings.some(w => w.includes('排除全部日志'))).toBe(true);
  const missing = buildDiagnosticBundle({ selection, run, version: 'v', warnings: [] });
  expect(missing.entries.some(entry => entry.id === 'log-coverage')).toBe(false);
  expect(missing.warnings.some(w => w.includes('缺失数量未知'))).toBe(true);
});
it('redacts full paths before short inherited environment values and keeps consistent placeholders', () => {
  const redact = createBundleRedactor(['C:', '1'], []);
  expect(redact('C:\\Users\\private-person\\file')).toBe('[PATH_1]');
  expect(redact('C:\\Users\\private-person\\file')).toBe('[PATH_1]');
  expect(redact('/unusual/private/location')).toBe('[PATH_2]');
});
it('bounds time, dictionary, record count and serialized bytes', () => {
  expect(DiagnosticBundleInputSchema.safeParse({ ...selection, to: '2026-09-01T00:00:00Z' }).success).toBe(false);
  expect(DiagnosticBundleInputSchema.safeParse({ ...selection, to: '2026-10-01T00:00:00Z' }).success).toBe(false);
  expect(() => createBundleRedactor(['x'.repeat(65537)], [])).toThrow('budget');
  const result = buildDiagnosticBundle({ selection, run, version: 'v', warnings: [], redact: createBundleRedactor([], []),
    logs: { ...logs, entries: Array.from({ length: 200 }, (_, i) => ({ ...logs.entries[0], id: String(i), message: '界'.repeat(5000) })) } });
  expect(result.bytes).toBeLessThanOrEqual(DIAGNOSTIC_BUNDLE_MAX_BYTES);
  expect(result.warnings.some(w => w.includes('1 MiB'))).toBe(true);
});

import { describe, expect, it, vi } from 'vitest';
import type { AnalysisSnapshot, ProjectModule, RunProfile, SuggestedCommand } from '@codehelm/domain';
import {
  AUTO_PROFILE_NAME,
  buildDetectedServices,
  mergeDetectedServices,
  upsertAutoDetectedProfile,
} from '../auto-profile.js';

const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`cipher:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().replace(/^cipher:/, '')),
}));

vi.mock('electron', () => ({ safeStorage: storage }));

function command(type: SuggestedCommand['type'], name: string, port?: number): SuggestedCommand {
  return {
    name,
    executable: 'pnpm',
    args: ['run', 'dev'],
    type,
    confidence: 0.98,
    source: 'package.json',
    port,
  };
}

function module(relativePath: string, commands: SuggestedCommand[]): ProjectModule {
  return {
    id: relativePath,
    snapshotId: 'snapshot',
    name: relativePath,
    relativePath,
    moduleType: 'tool',
    technologies: [],
    suggestedCommands: commands,
  };
}

describe('auto-detected run profile', () => {
  it('prefers concrete child services over a workspace proxy script', () => {
    const snapshot: AnalysisSnapshot = {
      id: 'snapshot',
      projectId: 'project',
      analyzerVersion: '1.1.0',
      status: 'completed',
      primaryLanguage: 'TypeScript',
      languages: [],
      modules: [
        module('.', [command('tool', 'Workspace dev')]),
        module('apps/web', [command('frontend', 'Web', 5173)]),
        module('apps/api', [command('backend', 'API', 3000)]),
      ],
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
    };

    const services = buildDetectedServices(snapshot);

    expect(services.map((service) => service.name)).toEqual(['Web', 'API']);
    expect(services.map((service) => service.cwdRelative)).toEqual(['apps/web', 'apps/api']);
    expect(services[0].dependsOn).toEqual([services[1].id]);
    expect(services[0].startTimeoutMs).toBeUndefined();
    expect(services[1].startTimeoutMs).toBe(30_000);
  });

  it('refreshes detected ports while preserving manually edited services', () => {
    const snapshot: AnalysisSnapshot = {
      id: 'snapshot',
      projectId: 'project',
      analyzerVersion: '1.1.0',
      status: 'completed',
      primaryLanguage: 'JavaScript',
      languages: [],
      modules: [
        module('client', [command('frontend', 'Web', 5173)]),
        module('server', [command('backend', 'API', 3001)]),
      ],
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
    };
    const detected = buildDetectedServices(snapshot);
    const existing = detected.map((service, index) => ({
      ...service,
      id: `existing-${index}`,
      runProfileId: 'profile-1',
      port: service.type === 'backend' ? 3000 : 5180,
      source: service.type === 'frontend' ? 'manual' as const : 'detected' as const,
      startTimeoutMs: service.type === 'frontend' ? 15_000 : service.startTimeoutMs,
    }));
    const refreshed = detected.map((service) => ({
      ...service,
      port: service.type === 'backend' ? 3001 : 5173,
    }));

    const merged = mergeDetectedServices(existing, refreshed);
    expect(merged.find((service) => service.type === 'backend')?.port).toBe(3001);
    expect(merged.find((service) => service.type === 'frontend')?.port).toBe(5180);
    expect(merged.find((service) => service.type === 'frontend')?.startTimeoutMs).toBe(15_000);
    expect(merged.find((service) => service.type === 'backend')?.startTimeoutMs).toBe(30_000);
    expect(merged.find((service) => service.type === 'frontend')?.dependsOn).toEqual([
      merged.find((service) => service.type === 'backend')?.id,
    ]);
  });

  it('keeps a standalone tool command when there are no runnable child modules', () => {
    const snapshot: AnalysisSnapshot = {
      id: 'snapshot',
      projectId: 'project',
      analyzerVersion: '1.1.0',
      status: 'completed',
      primaryLanguage: 'Python',
      languages: [],
      modules: [module('.', [command('tool', 'Python Application')])],
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
    };

    expect(buildDetectedServices(snapshot)).toHaveLength(1);
  });

  it('protects and preserves environment values during auto-profile refresh', async () => {
    const snapshot: AnalysisSnapshot = {
      id: 'snapshot',
      projectId: 'project',
      analyzerVersion: '1.1.0',
      status: 'completed',
      primaryLanguage: 'JavaScript',
      languages: [],
      modules: [module('web', [command('frontend', 'Web', 5173)])],
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
    };
    const detected = buildDetectedServices(snapshot)[0];
    const existing: RunProfile = {
      id: 'profile-1',
      projectId: 'project',
      name: AUTO_PROFILE_NAME,
      isDefault: true,
      failurePolicy: 'block_dependents',
      services: [{
        ...detected,
        id: 'service-1',
        runProfileId: 'profile-1',
        env: [{ key: 'API_TOKEN', value: 'legacy-secret', isSecret: true }],
      }],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    let saved: RunProfile | null = null;
    const repo = {
      findByProjectId: () => [existing],
      save: (profile: RunProfile) => {
        saved = profile;
        return profile;
      },
    };

    await upsertAutoDetectedProfile(repo as never, 'project', snapshot);

    expect(saved).not.toBeNull();
    const persisted = saved as unknown as RunProfile;
    expect(persisted.services[0].env[0].value).toContain('codehelm-secret-v1:');
    expect(storage.decryptString(Buffer.from(
      persisted.services[0].env[0].value.replace('codehelm-secret-v1:', ''),
      'base64'
    ))).toBe('legacy-secret');
  });
});

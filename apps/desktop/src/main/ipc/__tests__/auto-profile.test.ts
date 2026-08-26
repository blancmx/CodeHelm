import { describe, expect, it } from 'vitest';
import type { AnalysisSnapshot, ProjectModule, SuggestedCommand } from '@codehelm/domain';
import { buildDetectedServices, mergeDetectedServices } from '../auto-profile.js';

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
    }));
    const refreshed = detected.map((service) => ({
      ...service,
      port: service.type === 'backend' ? 3001 : 5173,
    }));

    const merged = mergeDetectedServices(existing, refreshed);
    expect(merged.find((service) => service.type === 'backend')?.port).toBe(3001);
    expect(merged.find((service) => service.type === 'frontend')?.port).toBe(5180);
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
});

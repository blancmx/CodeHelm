import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { SCHEMA_SQL } from '../schema.js';
import { ProjectRepository } from '../repositories/project-repository.js';
import { ProfileRepository } from '../repositories/profile-repository.js';
import { AnalysisRepository } from '../repositories/analysis-repository.js';

describe('Database Repositories with in-memory SQLite', () => {
  let db: DatabaseInstance;
  let projectRepo: ProjectRepository;
  let profileRepo: ProfileRepository;
  let analysisRepo: AnalysisRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);

    projectRepo = new ProjectRepository(db);
    profileRepo = new ProfileRepository(db);
    analysisRepo = new AnalysisRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create, list and query projects', () => {
    const project = projectRepo.create({
      name: 'Test Project',
      rootPath: 'E:/projects/test-project',
      tags: ['fullstack', 'vite'],
    });

    expect(project.id).toBeDefined();
    expect(project.name).toBe('Test Project');

    const found = projectRepo.findById(project.id);
    expect(found).not.toBeNull();
    expect(found?.rootPath).toBe('E:/projects/test-project');

    const list = projectRepo.list();
    expect(list.length).toBe(1);
    expect(list[0].tags).toEqual(['fullstack', 'vite']);
  });

  it('should prevent duplicate root_path', () => {
    projectRepo.create({
      name: 'P1',
      rootPath: 'E:/projects/dup',
    });

    expect(() => {
      projectRepo.create({
        name: 'P2',
        rootPath: 'E:/projects/dup',
      });
    }).toThrow();
  });

  it('summarizes only the latest snapshot while retaining historical modules', () => {
    const project = projectRepo.create({ name: 'Repeated analysis', rootPath: 'E:/projects/repeated' });
    const empty = projectRepo.create({ name: 'Unanalyzed', rootPath: 'E:/projects/empty' });
    const save = (id: string, startedAt: string, count: number, primaryLanguage: string) => analysisRepo.save({
      id, projectId: project.id, analyzerVersion: 'test', status: 'completed', primaryLanguage,
      languages: [], startedAt,
      modules: Array.from({ length: count }, (_, index) => ({
        id: `${id}-${index}`, snapshotId: id, name: `module-${index}`, relativePath: `module-${index}`,
        moduleType: 'backend' as const, technologies: [],
      })),
    });
    save('older', '2026-08-28T00:00:00.000Z', 3, 'Python');
    save('latest', '2026-08-28T00:01:00.000Z', 2, 'TypeScript');
    // A late insertion with an older scan timestamp must not become latest.
    save('backfill', '2026-08-27T00:00:00.000Z', 4, 'Java');
    expect(projectRepo.list().find((item) => item.id === project.id)).toMatchObject({
      moduleCount: analysisRepo.findLatestByProjectId(project.id)!.modules.length,
      primaryLanguages: ['TypeScript'],
    });
    expect(analysisRepo.findById('older')!.modules).toHaveLength(3);
    expect(projectRepo.list().find((item) => item.id === empty.id)).toMatchObject({ moduleCount: 0, primaryLanguages: [] });

    save('latest-empty', '2026-08-28T00:02:00.000Z', 0, 'Unknown');
    expect(projectRepo.list().find((item) => item.id === project.id)?.moduleCount).toBe(0);
    expect(analysisRepo.findById('latest')!.modules).toHaveLength(2);
  });

  it('uses the same insertion tie-breaker for summary and detail snapshots', () => {
    const project = projectRepo.create({ name: 'Same millisecond', rootPath: 'E:/projects/tie' });
    for (const [id, primaryLanguage, count] of [['z-first', 'Python', 2], ['a-second', 'Go', 1]] as const) {
      analysisRepo.save({
        id, projectId: project.id, analyzerVersion: 'test', status: 'completed', primaryLanguage,
        languages: [], startedAt: '2026-08-28T00:00:00.000Z',
        modules: Array.from({ length: count }, (_, index) => ({
          id: `${id}-${index}`, snapshotId: id, name: id, relativePath: '.',
          moduleType: 'backend' as const, technologies: [],
        })),
      });
    }
    expect(analysisRepo.findLatestByProjectId(project.id)?.id).toBe('a-second');
    expect(projectRepo.list()[0]).toMatchObject({ moduleCount: 1, primaryLanguages: ['Go'] });
  });

  it('should save and retrieve run profile with services', () => {
    const project = projectRepo.create({
      name: 'P1',
      rootPath: 'E:/projects/p1',
    });

    const saved = profileRepo.save({
      projectId: project.id,
      name: 'Dev Profile',
      failurePolicy: 'block_dependents',
      services: [
        {
          id: 'srv-1',
          runProfileId: '',
          name: 'Web',
          type: 'frontend',
          moduleRelativePath: 'web',
          executable: 'pnpm',
          args: ['run', 'dev'],
          cwdRelative: 'web',
          env: [{ key: 'PORT', value: '3000' }],
          dependsOn: [],
          enabled: true,
          source: 'detected',
        },
      ],
    });

    expect(saved.id).toBeDefined();
    expect(saved.services.length).toBe(1);
    expect(saved.services[0].name).toBe('Web');
    expect(saved.services[0].env[0].key).toBe('PORT');

    const profiles = profileRepo.findByProjectId(project.id);
    expect(profiles.length).toBe(1);
    expect(profiles[0].services[0].executable).toBe('pnpm');
  });

  it('should save and retrieve analysis snapshot', () => {
    const project = projectRepo.create({
      name: 'P1',
      rootPath: 'E:/projects/p1',
    });

    const snap = analysisRepo.save({
      projectId: project.id,
      analyzerVersion: '1.0.0',
      status: 'completed',
      primaryLanguage: 'TypeScript',
      languages: [{ language: 'TypeScript', fileCount: 12, percentage: 80 }],
      modules: [
        {
          id: 'mod-1',
          snapshotId: '',
          name: 'web',
          relativePath: 'web',
          moduleType: 'frontend',
          technologies: [
            {
              name: 'Vue 3',
              category: 'frontend_framework',
              confidence: 1.0,
              evidence: [{ type: 'manifest', filePath: 'package.json', detail: 'vue@^3.0' }],
              source: 'detected',
            },
          ],
        },
      ],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    expect(snap.id).toBeDefined();
    expect(snap.primaryLanguage).toBe('TypeScript');
    expect(snap.modules.length).toBe(1);
    expect(snap.modules[0].technologies[0].name).toBe('Vue 3');

    const latest = analysisRepo.findLatestByProjectId(project.id);
    expect(latest?.id).toBe(snap.id);
  });
});

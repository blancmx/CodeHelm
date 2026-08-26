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

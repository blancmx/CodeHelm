import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase, ProjectRepository, ProfileRepository, SessionRepository } from '@codehelm/database';
import { Orchestrator, ProcessVerifier } from '@codehelm/runner';
import type { RunProfile, RunSession, ServiceSession } from '@codehelm/domain';
import { inspectHistoricalService, recoverInterruptedSessions } from '../session-recovery.js';

describe('durable session lifecycle and restart inspection', () => {
  let root: string;
  let db: ReturnType<typeof createDatabase>;
  let repository: SessionRepository;
  let profile: RunProfile;
  const runners: Orchestrator[] = [];
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-session-'));
    db = createDatabase(path.join(root, 'data.sqlite'));
    repository = new SessionRepository(db);
    const project = new ProjectRepository(db).create({ name: '隔离会话测试', rootPath: root });
    profile = new ProfileRepository(db).save({ projectId: project.id, name: 'test', failurePolicy: 'continue', services: [{
      id: 'service-a', runProfileId: '', name: 'node fixture', type: 'tool', moduleRelativePath: '.',
      executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwdRelative: '.', env: [],
      dependsOn: [], enabled: true, source: 'manual',
    }] });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(runners.splice(0).map(r => r.stopAll()));
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function runner() {
    const result = new Orchestrator();
    result.setSessionPersistence(s => repository.save(s));
    runners.push(result);
    return result;
  }
  function historical(services: Partial<ServiceSession>[]): RunSession {
    return {
      id: randomUUID(), projectId: profile.projectId, runProfileId: profile.id, status: 'RUNNING',
      startedAt: '2026-01-01T00:00:00.000Z', services: services.map((service, i) => ({
        id: `old-${i}`, runSessionId: '', serviceConfigId: 'service-a', serviceName: `old ${i}`,
        serviceType: 'tool', status: 'RUNNING', pid: 10000 + i, ...service,
      })),
    };
  }
  function saveHistory(session: RunSession) {
    session.services.forEach(s => s.runSessionId = session.id);
    repository.save(session);
  }

  it('persists pre-spawn intent, PID/fingerprint, readiness and graceful stop across database reopen', async () => {
    const service = runner();
    const states: RunSession[] = [];
    service.setSessionPersistence(s => { states.push(structuredClone(s)); repository.save(s); });
    const session = await service.startSession(root, profile);
    expect(states.some(s => s.status === 'STARTING' && s.services.some(child => child.pid === undefined))).toBe(true);
    expect(repository.findById(session.id)?.services[0].pid).toBe(session.services[0].pid);
    expect(repository.findById(session.id)?.services[0].fingerprint?.argsSummary).toBe('');
    await service.stopSession(session.id);
    expect(ProcessVerifier.isPidAlive(session.services[0].pid!)).toBe(false);
    db.close();
    db = createDatabase(path.join(root, 'data.sqlite'));
    repository = new SessionRepository(db);
    expect(repository.findById(session.id)).toMatchObject({ status: 'STOPPED', services: [{ status: 'STOPPED', stoppedAt: expect.any(String) }] });
    expect(await recoverInterruptedSessions(repository)).toBe(0);
  }, 20000);

  it('preserves spawn errors and natural nonzero exit status, including after shutdown', async () => {
    const service = runner();
    profile.services[0].args = ['-e', 'process.exit(7)'];
    const exited = await service.startSession(root, profile);
    expect(repository.findById(exited.id)).toMatchObject({ status: 'FAILED', services: [{ status: 'FAILED', exitCode: 7 }] });
    profile.services[0].executable = 'codehelm-missing-fixture-command';
    const failed = await service.startSession(root, profile);
    expect(repository.findById(failed.id)?.services[0].errorMessage).toBeTruthy();
    await service.stopAll();
    expect(repository.findById(exited.id)?.services[0].exitCode).toBe(7);
    expect(repository.findById(exited.id)?.status).toBe('FAILED');
    expect(repository.findById(failed.id)?.services[0].status).toBe('FAILED');
  }, 20000);

  it('retains old service rows when restarting, and later exit callbacks update the new row', async () => {
    const service = runner();
    const session = await service.startSession(root, profile);
    const firstId = session.services[0].id;
    const restarted = await service.restartService(firstId);
    expect(restarted.id).not.toBe(firstId);
    expect(restarted.status).toBe('RUNNING');
    expect(repository.findById(session.id)?.stoppedAt).toBeUndefined();
    expect(repository.findById(session.id)?.services).toHaveLength(2);
    expect(repository.findById(session.id)?.services.find(s => s.id === firstId)?.status).toBe('STOPPED');
    await service.stopService(restarted.id);
    expect(repository.findById(session.id)?.services.every(s => s.status === 'STOPPED')).toBe(true);
  }, 20000);

  async function configureReadiness(type: 'http' | 'tcp', timeoutMs = 10000) {
    const net = await import('node:net');
    const listener = net.createServer();
    await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = (listener.address() as import('node:net').AddressInfo).port;
    await new Promise<void>(resolve => listener.close(() => resolve()));
    fs.writeFileSync(path.join(root, 'ready'), 'ready');
    fs.writeFileSync(path.join(root, 'readiness.cjs'), `
      const fs = require('node:fs');
      if (fs.existsSync('fail')) process.exit(9);
      const server = require('node:http').createServer((req, res) => {
        res.writeHead(fs.existsSync('ready') ? 204 : 503); res.end();
      });
      const start = () => server.listen(Number(process.argv[2]), '127.0.0.1', () => fs.writeFileSync('listening', String(process.pid)));
      if (${JSON.stringify(type)} === 'http' || fs.existsSync('ready')) start();
      else { const timer = setInterval(() => { if (fs.existsSync('ready')) { clearInterval(timer); start(); } }, 25); }
      setTimeout(() => process.exit(0), 60000).unref();
    `);
    Object.assign(profile.services[0], { args: [path.join(root, 'readiness.cjs'), '{{PORT}}'], port, portMode: 'fixed',
      healthCheck: { type, port, expectedStatus: 204 }, startTimeoutMs: timeoutMs });
  }

  it.each(['tcp', 'http'] as const)('waits for %s readiness on restart and deduplicates concurrent restart clicks', async type => {
    await configureReadiness(type);
    const service = runner();
    const session = await service.startSession(root, profile);
    expect(session.services[0].status).toBe('RUNNING');
    fs.unlinkSync(path.join(root, 'ready'));
    const firstId = session.services[0].id;
    let resolved = false;
    const first = service.restartService(firstId).then(child => { resolved = true; return child; });
    const second = service.restartService(firstId);
    await vi.waitFor(() => expect(session.services[1]?.pid).toBeTypeOf('number'), { timeout: 10000 });
    expect(resolved).toBe(false);
    expect(session.services[1].status).toBe('STARTING');
    fs.writeFileSync(path.join(root, 'ready'), 'ready');
    const [left, right] = await Promise.all([first, second]);
    expect(left.id).toBe(right.id);
    expect(left.status).toBe('RUNNING');
    expect(session.services).toHaveLength(2);
    expect(repository.findById(session.id)?.stoppedAt).toBeUndefined();
  }, 25000);

  it('persists a readiness timeout and an early nonzero exit instead of declaring restart ready', async () => {
    await configureReadiness('http', 500);
    const service = runner();
    const session = await service.startSession(root, profile);
    fs.unlinkSync(path.join(root, 'ready'));
    const timeout = await service.restartService(session.services[0].id);
    expect(timeout.status).toBe('DEGRADED');
    expect(repository.findById(session.id)?.services.find(s => s.id === timeout.id)?.errorMessage).toContain('就绪检查');
    fs.writeFileSync(path.join(root, 'fail'), 'fail');
    const failed = await service.restartService(timeout.id);
    expect(failed).toMatchObject({ status: 'FAILED', exitCode: 9 });
    expect(repository.findById(session.id)?.services.find(s => s.id === failed.id)?.exitCode).toBe(9);
  }, 25000);

  it.each(['session', 'service'] as const)('cancels a pending restart when stopping the %s, without spawning a replacement', async target => {
    const service = runner();
    const session = await service.startSession(root, profile);
    const id = session.services[0].id;
    const restarting = service.restartService(id).then(() => 'unexpected restart', error => error.message);
    if (target === 'session') await service.stopSession(session.id);
    else await service.stopService(id);
    expect(await restarting).toContain('取消');
    expect(session.services).toHaveLength(1);
    expect(ProcessVerifier.isPidAlive(session.services[0].pid!)).toBe(false);
    expect(repository.findById(session.id)?.status).toBe('STOPPED');
  }, 20000);

  it('aborts a long readiness wait and stops the replacement during application shutdown', async () => {
    await configureReadiness('http', 30000);
    const service = runner();
    const session = await service.startSession(root, profile);
    fs.unlinkSync(path.join(root, 'ready'));
    const restarting = service.restartService(session.services[0].id);
    await vi.waitFor(() => expect(session.services[1]?.pid).toBeTypeOf('number'), { timeout: 10000 });
    await service.stopAll();
    await restarting;
    expect(session.services).toHaveLength(2);
    expect(session.services.every(child => !ProcessVerifier.isPidAlive(child.pid!))).toBe(true);
    expect(repository.findById(session.id)?.status).toBe('STOPPED');
  }, 20000);

  it('records failed port preparation rather than silently losing the attempted service', async () => {
    const net = await import('node:net');
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as import('node:net').AddressInfo).port;
      profile.services[0].port = port;
      profile.services[0].portMode = 'fixed';
      const session = await runner().startSession(root, profile);
      expect(repository.findById(session.id)).toMatchObject({ status: 'FAILED', services: [{ status: 'FAILED', port, errorMessage: expect.any(String) }] });
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('does not spawn a later DAG layer when shutdown occurs during startup', async () => {
    const service = runner();
    profile.services.push({ ...profile.services[0], id: 'later-service', dependsOn: ['service-a'] });
    const starting = service.startSession(root, profile);
    await vi.waitFor(() => expect(service.getActiveSessions()[0]?.services.length).toBe(1), { timeout: 5000 });
    await service.stopAll();
    const session = await starting;
    expect(session.services).toHaveLength(1);
    expect(repository.findById(session.id)?.status).toBe('STOPPED');
    expect(ProcessVerifier.isPidAlive(session.services[0].pid!)).toBe(false);
  }, 20000);

  it('blocks spawning when intent cannot be saved and exposes a durable-state error', async () => {
    const service = runner();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.setSessionPersistence(() => { throw new Error('SQLITE_FULL fixture'); });
    await expect(service.startSession(root, profile)).rejects.toThrow('运行记录写入失败');
    expect(service.getActiveSessions()).toEqual([]);
    expect(service.getPersistenceError()).toBeTruthy();
    expect(log).toHaveBeenCalled();
    expect(repository.listRecent()).toEqual([]);
  });

  it('stops a newly spawned child if saving its PID fails, rather than reporting a successful start', async () => {
    const service = runner();
    let childPid: number | undefined;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    service.setSessionPersistence(s => {
      if (s.services[0]?.pid) { childPid = s.services[0].pid; throw new Error('disk full after spawn'); }
      repository.save(s);
    });
    await expect(service.startSession(root, profile)).rejects.toThrow('运行记录写入失败');
    expect(childPid).toBeTypeOf('number');
    expect(ProcessVerifier.isPidAlive(childPid!)).toBe(false);
    expect(service.getPersistenceError()).toBeTruthy();
  }, 20000);

  it('keeps a failed stop as ORPHANED and does not signal a child whose identity no longer matches', async () => {
    const service = runner();
    const session = await service.startSession(root, profile);
    const mismatch = vi.spyOn(ProcessVerifier, 'isFingerprintCurrent').mockReturnValue(false);
    try {
      await expect(service.stopService(session.services[0].id)).rejects.toThrow('无法确认服务已停止');
      expect(ProcessVerifier.isPidAlive(session.services[0].pid!)).toBe(true);
      expect(repository.findById(session.id)?.services[0].status).toBe('ORPHANED');
    } finally { mismatch.mockRestore(); }
  }, 20000);

  it('rolls back a whole snapshot if a service insert fails', () => {
    const session = historical([{ serviceName: undefined as never }]);
    expect(() => saveHistory(session)).toThrow();
    expect(repository.findById(session.id)).toBeUndefined();
  });

  it('classifies interrupted records conservatively, without fabricating exit time or adopting a PID', async () => {
    const session = historical([{}, {}, {}, {}]);
    saveHistory(session);
    const outcomes = ['not-running', 'identity-match', 'pid-reused', 'unverified'] as const;
    await recoverInterruptedSessions(repository, async s => outcomes[Number(s.id.split('-')[1])]);
    const saved = repository.findById(session.id)!;
    expect(saved.status).toBe('INTERRUPTED');
    expect(saved.services.map(s => s.status)).toEqual(['STOPPED','ORPHANED','STOPPED','ORPHANED']);
    expect(saved.services.every(s => s.stoppedAt === undefined && s.recovery?.checkedAt)).toBe(true);
    expect(repository.hasUnresolvedProfile(profile.id)).toBe(true);
    const service = runner();
    expect(service.getActiveSessions()).toEqual([]);
    await expect(service.stopSession(session.id)).rejects.toThrow('历史会话');
    await expect(service.stopService(saved.services[1].id)).rejects.toThrow('历史');
    await expect(service.restartService(saved.services[1].id)).rejects.toThrow('not found');
  });

  it('keeps completed history unchanged and fails closed when inspection throws', async () => {
    const session = historical([{ status: 'FAILED', exitCode: 9, errorMessage: 'previous error' }, {}]);
    saveHistory(session);
    await recoverInterruptedSessions(repository, async () => { throw new Error('access denied'); });
    const saved = repository.findById(session.id)!;
    expect(saved.services[0]).toMatchObject({ status: 'FAILED', exitCode: 9, errorMessage: 'previous error' });
    expect(saved.services[0].recovery).toBeUndefined();
    expect(saved.services[1].recovery?.outcome).toBe('unverified');
  });

  it('checks a persisted live child against real OS creation time without terminating it', async () => {
    // Reopen only the database; this tests real identity inspection, not a parent crash.
    const owner = runner();
    const session = await owner.startSession(root, profile);
    const child = session.services[0];
    expect(child.fingerprint?.identityVerified).toBe(true);
    db.close();
    db = createDatabase(path.join(root, 'data.sqlite'));
    repository = new SessionRepository(db);

    expect(await recoverInterruptedSessions(repository)).toBe(1);
    const recovered = repository.findById(session.id)!;
    expect(recovered.status).toBe('INTERRUPTED');
    expect(recovered.services[0]).toMatchObject({
      id: child.id, pid: child.pid, status: 'ORPHANED',
      recovery: { outcome: 'identity-match', checkedAt: expect.any(String) },
    });
    expect(recovered.services[0].stoppedAt).toBeUndefined();
    expect(recovered.services[0].exitCode).toBeUndefined();
    expect(repository.hasUnresolvedProfile(profile.id)).toBe(true);
    expect(ProcessVerifier.isPidAlive(child.pid!)).toBe(true);
  }, 20000);

  it('lists unresolved records outside recent history and removes them only after resolution', () => {
    const old = historical([{ status: 'ORPHANED' }]);
    old.status = 'INTERRUPTED';
    saveHistory(old);
    for (let i = 0; i < 101; i++) {
      const recent = historical([]);
      recent.status = 'STOPPED';
      recent.startedAt = '2026-08-28T00:00:00.000Z';
      saveHistory(recent);
    }
    expect(repository.listRecent(100).some(session => session.id === old.id)).toBe(false);
    expect(repository.listUnresolved().map(session => session.id)).toEqual([old.id]);
    expect(repository.hasUnresolvedProfile(profile.id)).toBe(true);
    old.services[0].status = 'STOPPED';
    old.services[0].recovery = { outcome: 'not-running', checkedAt: new Date().toISOString() };
    saveHistory(old);
    expect(repository.listUnresolved()).toEqual([]);
    expect(repository.hasUnresolvedProfile(profile.id)).toBe(false);
    expect(repository.findById(old.id)?.status).toBe('INTERRUPTED');
  });

  it('lists unresolved records outside recent history and removes them only after resolution', () => {
    const old = historical([{ status: 'ORPHANED' }]);
    old.status = 'INTERRUPTED';
    saveHistory(old);
    for (let i = 0; i < 101; i++) {
      const recent = historical([]);
      recent.status = 'STOPPED';
      recent.startedAt = '2026-08-28T00:00:00.000Z';
      saveHistory(recent);
    }
    expect(repository.listRecent(100).some(session => session.id === old.id)).toBe(false);
    expect(repository.listUnresolved().map(session => session.id)).toEqual([old.id]);
    expect(repository.hasUnresolvedProfile(profile.id)).toBe(true);
    old.services[0].status = 'STOPPED';
    old.services[0].recovery = { outcome: 'not-running', checkedAt: new Date().toISOString() };
    saveHistory(old);
    expect(repository.listUnresolved()).toEqual([]);
    expect(repository.hasUnresolvedProfile(profile.id)).toBe(false);
    expect(repository.findById(old.id)?.status).toBe('INTERRUPTED');
  });

  it('never proves ownership from missing/unverified fingerprints, even for a live PID', async () => {
    const session = historical([{ pid: process.pid }]);
    expect(await inspectHistoricalService(session.services[0])).toBe('unverified');
    session.services[0].fingerprint = { pid: process.pid, startTime: Date.now(), identityVerified: false, executable: '', cwd: '', argsSummary: '' };
    expect(await inspectHistoricalService(session.services[0])).toBe('unverified');
  });

  it('distinguishes matching identity, reused PID, missing OS information and inspection errors', async () => {
    const child = historical([{ pid: process.pid, fingerprint: { pid: process.pid, startTime: 100, identityVerified: true, executable: 'node', cwd: root, argsSummary: '' } }]).services[0];
    expect(await inspectHistoricalService(child, async () => 100)).toBe('identity-match');
    expect(await inspectHistoricalService(child, async () => 101)).toBe('pid-reused');
    expect(await inspectHistoricalService(child, async () => undefined)).toBe('unverified');
    expect(await inspectHistoricalService(child, async () => { throw new Error('EACCES'); })).toBe('unverified');
    const alive = vi.spyOn(ProcessVerifier, 'isPidAlive').mockReturnValue(false);
    expect(await inspectHistoricalService(child, async () => 100)).toBe('not-running');
    alive.mockRestore();
  });
});

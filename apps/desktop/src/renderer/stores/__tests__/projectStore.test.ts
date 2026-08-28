import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useProjectStore } from '../projectStore.js';

describe('project list read state', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('distinguishes an unreadable database from a successfully read empty list and allows retry', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('database disk image is malformed')).mockResolvedValueOnce([]);
    vi.stubGlobal('window', { codehelm: { projects: { list } } });
    const store = useProjectStore();

    expect(await store.fetchProjects()).toBe(false);
    expect(store.hasLoadedProjects).toBe(false);
    expect(store.listError).toContain('数据库完整性异常');
    expect(store.loading).toBe(false);

    expect(await store.fetchProjects()).toBe(true);
    expect(store.hasLoadedProjects).toBe(true);
    expect(store.projects).toEqual([]);
    expect(store.listError).toBeNull();
  });

  it('keeps the last successful project list when refreshing fails', async () => {
    const projects = [{ id: 'project-1', name: 'existing' }];
    const list = vi.fn().mockResolvedValueOnce(projects).mockRejectedValueOnce(new Error('IPC unavailable'));
    vi.stubGlobal('window', { codehelm: { projects: { list } } });
    const store = useProjectStore();

    await store.fetchProjects();
    expect(await store.fetchProjects()).toBe(false);
    expect(store.projects).toEqual(projects);
    expect(store.hasLoadedProjects).toBe(true);
    expect(store.listError).toContain('IPC unavailable');
  });

  it('reports a missing desktop API instead of claiming an empty list', async () => {
    vi.stubGlobal('window', {});
    const store = useProjectStore();
    expect(await store.fetchProjects()).toBe(false);
    expect(store.hasLoadedProjects).toBe(false);
    expect(store.listError).toContain('项目数据接口不可用');
  });

  it('does not let a stale error overwrite a newer successful read', async () => {
    let rejectOld!: (error: Error) => void;
    const oldRequest = new Promise((_resolve, reject) => { rejectOld = reject; });
    const list = vi.fn().mockReturnValueOnce(oldRequest).mockResolvedValueOnce([]);
    vi.stubGlobal('window', { codehelm: { projects: { list } } });
    const store = useProjectStore();
    const oldFetch = store.fetchProjects();
    expect(await store.fetchProjects()).toBe(true);
    rejectOld(new Error('old failure'));
    await oldFetch;
    expect(store.hasLoadedProjects).toBe(true);
    expect(store.listError).toBeNull();
    expect(store.loading).toBe(false);
  });
});

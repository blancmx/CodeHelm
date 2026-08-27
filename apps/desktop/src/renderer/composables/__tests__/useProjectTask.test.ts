import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodeHelmApi, ProjectTaskDto, ProjectTaskProgressDto } from '@codehelm/contracts';
import { useProjectTask } from '../useProjectTask.js';

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); });

function fixture() {
  const result: ProjectTaskDto = { taskId: 'task', kind: 'import', status: 'running', stage: '导入中',
    completedCount: 0, totalCount: 2, scannedDirectories: 0, foundProjects: 0, scannedFiles: 0, discovered: [], results: [] };
  let listener: (state: ProjectTaskProgressDto) => void = () => {};
  const off = vi.fn();
  const api = {
    getTask: vi.fn(async () => structuredClone(result)),
    cancelTask: vi.fn(async () => ({ cancelled: true })),
    onTaskProgress: (callback: typeof listener) => { listener = callback; return off; },
  } as unknown as CodeHelmApi['projects'];
  const finished = vi.fn(); const error = vi.fn();
  const model = useProjectTask(api, finished, error);
  model.subscribe(); disposers.push(model.dispose);
  return { model, api, finished, error, off, result,
    start: () => model.start('import', async () => ({ taskId: 'task' })),
    emit: (status: ProjectTaskDto['status'], taskId = 'task') => { listener({ ...result, taskId, status }); },
  };
}

describe('import dialog task lifecycle', () => {
  it('does not finish when start returns, ignores unrelated events, and fetches full terminal results', async () => {
    const f = fixture(); await f.start();
    expect(f.model.busy.value).toBe(true);
    f.emit('completed', 'other');
    expect(f.finished).not.toHaveBeenCalled();
    f.result.status = 'partial';
    f.result.results = [{ rootPath: '/missing', name: 'missing', status: 'failed', errorMessage: 'not found' }];
    f.emit('partial');
    await vi.waitFor(() => expect(f.finished).toHaveBeenCalledOnce());
    expect(f.model.busy.value).toBe(false);
    expect(f.model.state.value?.results[0].errorMessage).toBe('not found');
    f.emit('partial'); await f.model.refresh();
    expect(f.finished).toHaveBeenCalledOnce();
  });

  it('recovers a result that finished before the start response', async () => {
    const f = fixture(); f.result.status = 'completed';
    await f.start();
    expect(f.finished).toHaveBeenCalledOnce();
    expect(f.model.busy.value).toBe(false);
  });

  it('polls when a terminal event was missed', async () => {
    vi.useFakeTimers();
    const f = fixture(); await f.start(); f.result.status = 'completed';
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.finished).toHaveBeenCalledOnce();
    f.model.dispose();
    expect(f.off).toHaveBeenCalledOnce();
  });

  it('awaits cancellation and retains the per-project result instead of reporting success', async () => {
    const f = fixture(); await f.start();
    f.result.status = 'cancelled';
    await f.model.cancel();
    expect(f.api.cancelTask).toHaveBeenCalledWith('task');
    expect(f.finished).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(f.model.busy.value).toBe(false);
  });

  it('cancels a late start after the dialog was reset and cannot overwrite the new selection', async () => {
    const f = fixture(); let resolve!: (value: { taskId: string }) => void;
    const pending = f.model.start('scan', () => new Promise((done) => { resolve = done; }));
    f.model.reset(); resolve({ taskId: 'late' }); await pending;
    expect(f.api.cancelTask).toHaveBeenCalledWith('late');
    expect(f.model.state.value).toBeNull();
    expect(f.finished).not.toHaveBeenCalled();
  });

  it('surfaces start and cancel errors without a false completion', async () => {
    const f = fixture();
    await f.model.start('scan', async () => { throw new Error('busy'); });
    expect(f.model.busy.value).toBe(false);
    expect(f.error).toHaveBeenCalledOnce();
    await f.start();
    vi.mocked(f.api.cancelTask).mockRejectedValueOnce(new Error('IPC failed'));
    await f.model.cancel();
    expect(f.model.busy.value).toBe(true);
    expect(f.finished).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledTimes(2);
  });
});

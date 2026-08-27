import { describe, expect, it, vi } from 'vitest';
import type { AnalysisTaskDto, CodeHelmApi } from '@codehelm/contracts';
import { useAnalysisTask } from '../useAnalysisTask.js';

function fixture() {
  let listener: (state: AnalysisTaskDto) => void = () => {};
  let projectId = 'project';
  const state: AnalysisTaskDto = { projectId, taskId: 'task', status: 'running', scannedFiles: 100, percentage: 20, stage: '扫描中' };
  const off = vi.fn();
  const api: CodeHelmApi['analysis'] = {
    start: vi.fn(async () => ({ taskId: 'task' })),
    cancel: vi.fn(async () => ({ cancelled: true })),
    getTask: vi.fn(async () => ({ ...state })),
    getLatest: vi.fn(async () => null),
    onProgress: (callback) => { listener = callback; return off; },
  };
  const finished = vi.fn();
  const error = vi.fn();
  const model = useAnalysisTask(api, () => projectId, finished, error);
  model.subscribe();
  return { model, api, state, finished, error, off,
    emit: (status: AnalysisTaskDto['status'], id = projectId) => listener({ ...state, status, projectId: id }),
    switchProject: () => { projectId = 'other'; model.reset(); },
  };
}

describe('analysis renderer lifecycle', () => {
  it('stays busy after start returns, filters other projects, and reloads only on terminal success', async () => {
    const f = fixture();
    await f.model.start();
    expect(f.model.busy.value).toBe(true);
    expect(f.finished).not.toHaveBeenCalled();
    f.emit('completed', 'other');
    expect(f.model.busy.value).toBe(true);
    f.emit('completed');
    f.emit('completed');
    expect(f.model.busy.value).toBe(false);
    expect(f.finished).toHaveBeenCalledOnce();
    f.model.dispose();
    expect(f.off).toHaveBeenCalledOnce();
  });

  it('recovers a result that completed before the start response and never gets stuck at 100%', async () => {
    const f = fixture();
    f.state.status = 'completed';
    f.state.percentage = 100;
    await f.model.start();
    expect(f.model.busy.value).toBe(false);
    expect(f.finished).toHaveBeenCalledOnce();
  });

  it('cancels the backend task and keeps failed/cancelled terminal state distinct from success', async () => {
    const f = fixture();
    await f.model.start();
    f.state.status = 'cancelled';
    await f.model.cancel();
    expect(f.api.cancel).toHaveBeenCalledWith('task');
    expect(f.finished).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(f.model.busy.value).toBe(false);
  });

  it('cancels when switching projects and ignores stale progress from the old project', async () => {
    const f = fixture();
    await f.model.start();
    f.switchProject();
    f.emit('running', 'project');
    expect(f.api.cancel).toHaveBeenCalledWith('task');
    expect(f.model.task.value).toBeNull();
  });

  it('cancels a late start response after the view was closed', async () => {
    const f = fixture();
    let resolve!: (value: { taskId: string }) => void;
    vi.mocked(f.api.start).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = f.model.start();
    f.model.dispose();
    resolve({ taskId: 'late' });
    await pending;
    expect(f.api.cancel).toHaveBeenCalledWith('late');
    expect(f.finished).not.toHaveBeenCalled();
  });

  it('does not fake success when launch fails or cancel loses the commit race', async () => {
    const f = fixture();
    vi.mocked(f.api.start).mockRejectedValueOnce(new Error('busy'));
    await f.model.start();
    expect(f.model.busy.value).toBe(false);
    expect(f.error).toHaveBeenCalledOnce();
    await f.model.start();
    vi.mocked(f.api.cancel).mockResolvedValueOnce({ cancelled: false });
    f.state.status = 'saving';
    await f.model.cancel();
    expect(f.model.busy.value).toBe(true);
    expect(f.model.canCancel.value).toBe(false);
    expect(f.finished).not.toHaveBeenCalled();
  });
});

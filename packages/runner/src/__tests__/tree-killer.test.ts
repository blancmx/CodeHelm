import { beforeEach, expect, it, vi } from 'vitest';
import { killProcessTree } from '../process/tree-killer.js';

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('tree-kill', () => ({ default: dispatch }));
beforeEach(() => { dispatch.mockReset(); });

it('rejects a lost process identity before sending any signal', async () => {
  const fallback = vi.fn();
  await killProcessTree(123, 'SIGTERM', 3000, () => false, () => false, () => true, fallback);
  expect(dispatch).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

it('checks current ownership at dispatch and waits for termination', async () => {
  let alive = true;
  const ownership = vi.fn(() => true);
  dispatch.mockImplementation((_pid, _signal, callback) => {
    expect(ownership).toHaveBeenCalledOnce();
    alive = false;
    callback(null);
  });
  await killProcessTree(123, 'SIGTERM', 3000, ownership, () => false, () => alive);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(123, 'SIGTERM', expect.any(Function));
});

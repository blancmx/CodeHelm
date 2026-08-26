import { describe, expect, it } from 'vitest';
import { toIpcPayload } from '../ipc-payload.js';

describe('toIpcPayload', () => {
  it('detaches nested proxy objects into structured-clone-safe data', () => {
    const tags = new Proxy(['Vue', 'FastAPI'], {});
    const input = new Proxy({
      rootPath: 'E:/projects/openrepo',
      name: 'openrepo',
      tags,
    }, {});

    const payload = toIpcPayload(input);

    expect(payload).toEqual({
      rootPath: 'E:/projects/openrepo',
      name: 'openrepo',
      tags: ['Vue', 'FastAPI'],
    });
    expect(payload).not.toBe(input);
    expect(payload.tags).not.toBe(tags);
    expect(() => structuredClone(payload)).not.toThrow();
  });

  it('preserves optional undefined arguments', () => {
    expect(toIpcPayload(undefined)).toBeUndefined();
  });
});

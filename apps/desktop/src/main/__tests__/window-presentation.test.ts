import { describe, expect, it, vi } from 'vitest';
import { presentMainWindow } from '../window-presentation.js';

describe('main window presentation', () => {
  it('shows and focuses without changing persistent z-order', () => {
    const show = vi.fn();
    const focus = vi.fn();

    presentMainWindow({ show, focus });

    expect(show).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(show.mock.invocationCallOrder[0]).toBeLessThan(focus.mock.invocationCallOrder[0]);
  });
});

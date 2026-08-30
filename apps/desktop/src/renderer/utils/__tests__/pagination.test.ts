import { describe, expect, it } from 'vitest';
import { getPageBounds } from '../pagination.js';

describe('project result pagination', () => {
  it('keeps every project reachable in its sorted order without rendering the whole collection', () => {
    const projects = Array.from({ length: 500 }, (_, index) => index);
    const pages = Array.from({ length: getPageBounds(500, 1, 24).pageCount }, (_, index) => {
      const { start, end } = getPageBounds(500, index + 1, 24);
      return projects.slice(start, end);
    });
    expect(pages.flat()).toEqual(projects);
    expect(Math.max(...pages.map(page => page.length))).toBe(24);
    expect(pages.at(-1)).toHaveLength(20);
  });

  it('clamps the current page after a removal or filter leaves fewer results', () => {
    expect(getPageBounds(2, 21, 24)).toEqual({ page: 1, pageCount: 1, start: 0, end: 2 });
    expect(getPageBounds(0, 21, 24)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0 });
    expect(getPageBounds(500, -1, 24).page).toBe(1);
  });
});

/** Bound DOM work without changing the order or total of the underlying results. */
export function getPageBounds(total: number, requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, requestedPage));
  const start = (page - 1) * pageSize;
  return { page, pageCount, start, end: Math.min(total, start + pageSize) };
}

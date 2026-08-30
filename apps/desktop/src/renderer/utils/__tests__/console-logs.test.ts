import { computed, ref } from 'vue';
import * as Vue from 'vue';
import { parse, compileTemplate } from 'vue/compiler-sfc';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { LogEntryDto } from '@codehelm/contracts';
import { countLogsByProject, resolveLogProjectId } from '../console-logs.js';

const log = (id: string, serviceSessionId = 'session-a', serviceName = 'api'): LogEntryDto => ({
  id, serviceSessionId, serviceName, stream: 'stdout', message: `line ${id}`,
  timestamp: '2026-08-30T00:00:00Z',
});

describe('console log row memoization', () => {
  // Compile the actual row, so missing memo dependencies fail without copying the template.
  const source = readFileSync(new URL('../../views/ConsoleView.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const findRow = (node: any): any => {
    if (node.type === 1 && node.props.some((p: any) => p.name === 'class' && p.value?.content.includes('terminal-log-row'))) return node;
    for (const child of node.children ?? []) {
      const found = findRow(child);
      if (found) return found;
    }
  };
  const row = findRow(descriptor.template!.ast);
  const { code } = compileTemplate({ source: row.loc.source, filename: 'ConsoleView.vue', id: 'console-row-test', compilerOptions: { mode: 'function', prefixIdentifiers: true } });
  const render = new Function('Vue', code)(Vue);
  const context = () => ({
    filteredLogs: [log('a'), log('b')], showLineNumbers: true, showTimestamps: true,
    selectedProjectFilter: 'ALL', projectName: 'Project A',
    getEntryProjectName() { return this.projectName; }, copySingleLogLine: vi.fn(),
  });
  type HostNode = { children: HostNode[]; parent: HostNode | null; text?: string };
  const node = (): HostNode => ({ children: [], parent: null });
  const renderer = Vue.createRenderer<HostNode, HostNode>({
    createElement: node, createText: text => ({ ...node(), text }), createComment: node,
    setText: (el, text) => { el.text = text; }, setElementText: (el, text) => { el.text = text; },
    patchProp: () => {}, parentNode: el => el.parent,
    nextSibling: el => el.parent?.children[(el.parent?.children.indexOf(el) ?? -1) + 1] ?? null,
    remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
    insert(el, parent, anchor) {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, el);
      el.parent = parent;
    },
  });
  const mountRows = () => {
    const ctx = Vue.reactive(context()), cache: unknown[] = [];
    const vnode = Vue.h({ render: () => render(ctx, cache) });
    const root = node();
    renderer.render(vnode, root);
    return { ctx, rows: () => vnode.component!.subTree.children as Vue.VNode[], unmount: () => renderer.render(null, root) };
  };

  it('reuses unchanged rows across status refreshes', async () => {
    const { ctx, rows, unmount } = mountRows();
    const first = rows();
    ctx.filteredLogs = ctx.filteredLogs.map(entry => ({ ...entry }));
    await Vue.nextTick();
    const refreshed = rows();
    expect(refreshed[0]).toBe(first[0]);
    expect(refreshed[1]).toBe(first[1]);
    unmount();
  });

  it('keeps copy controls bound to the current log without mounting per-row components', async () => {
    const { ctx, rows, unmount } = mountRows();
    const descendants = (vnode: Vue.VNode): Vue.VNode[] => [vnode, ...(Array.isArray(vnode.children)
      ? vnode.children.filter(Vue.isVNode).flatMap(descendants) : [])];
    const button = () => descendants(rows()[0]).find(v => v.type === 'button')!;
    expect(descendants(rows()[0]).every(v => !v.component)).toBe(true);
    button().props!.onClick();
    expect(ctx.copySingleLogLine).toHaveBeenLastCalledWith('line a');
    ctx.filteredLogs[0] = { ...ctx.filteredLogs[0], message: 'changed output' };
    await Vue.nextTick();
    button().props!.onClick();
    expect(ctx.copySingleLogLine).toHaveBeenLastCalledWith('changed output');
    unmount();
  });

  it('updates changed content, stream, timestamp and service without invalidating unrelated rows', async () => {
    const { ctx, rows, unmount } = mountRows();
    let previous = rows();
    for (const patch of [{ message: 'new output' }, { stream: 'stderr' as const }, { timestamp: '2026-08-30T01:00:00Z' }, { serviceName: 'other' }]) {
      Object.assign(ctx.filteredLogs[0], patch);
      await Vue.nextTick();
      const updated = rows();
      expect(updated[0]).not.toBe(previous[0]);
      expect(updated[1]).toBe(previous[1]);
      previous = updated;
    }
    unmount();
  });

  it('updates display toggles, project labels and row numbers after filtering', async () => {
    const { ctx, rows, unmount } = mountRows();
    let previous = rows();
    for (const patch of [{ showLineNumbers: false }, { showTimestamps: false }, { selectedProjectFilter: 'project-a' }, { projectName: 'Renamed' }]) {
      Object.assign(ctx, patch);
      await Vue.nextTick();
      const updated = rows();
      expect(updated[0]).not.toBe(previous[0]);
      previous = updated;
    }
    ctx.filteredLogs = [ctx.filteredLogs[1]];
    await Vue.nextTick();
    expect(rows()[0]).not.toBe(previous[1]);
    unmount();
  });
});

describe('console project log counts', () => {
  it('prefers session ownership over a shared service name and retains the fallback for old logs', () => {
    const owners = new Map([['session-a', 'project-a'], ['session-b', 'project-b'], ['api', 'project-b']]);
    const entries = [log('a'), log('b', 'session-b'), log('old', 'old-session'), log('unknown', 'unknown', 'other')];
    expect(resolveLogProjectId(entries[0], owners)).toBe('project-a');
    expect(resolveLogProjectId(entries[2], owners)).toBe('project-b');
    expect(resolveLogProjectId(entries[3], owners)).toBeUndefined();
    expect([...countLogsByProject(entries, owners)]).toEqual([['project-a', 1], ['project-b', 2]]);
    expect(entries.map(e => e.id)).toEqual(['a', 'b', 'old', 'unknown']);
  });

  it('counts in one pass and does not resolve logs again for 500 project lookups', () => {
    const owners = new Map([['session-a', 'project-a']]);
    const lookup = vi.spyOn(owners, 'get');
    const entries = Array.from({ length: 398 }, (_, i) => log(String(i)));
    const counts = countLogsByProject(entries, owners);
    for (let i = 0; i < 500; i++) counts.get(`project-${i}`);
    expect(counts.get('project-a')).toBe(398);
    expect(lookup).toHaveBeenCalledTimes(entries.length);
  });

  it('invalidates the cached summary when logs or ownership change, including clearing the buffer', () => {
    const logs = ref([log('a')]);
    const owners = ref(new Map([['session-a', 'project-a']]));
    const counts = computed(() => countLogsByProject(logs.value, owners.value));
    expect(counts.value.get('project-a')).toBe(1);
    logs.value = [...logs.value, log('b')];
    expect(counts.value.get('project-a')).toBe(2);
    owners.value.set('session-a', 'project-b');
    expect([...counts.value]).toEqual([['project-b', 2]]);
    logs.value = [];
    expect(counts.value.size).toBe(0);
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalyzerEngine } from '../../engine/analyzer-engine.js';
import { DiscoveryEngine } from '../../discovery/discovery-engine.js';
import {
  ReadBudget,
  readUtf8FileWithinLimit,
} from '../bounded-read.js';
import type { Detector } from '../../types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('bounded analyzer reads', () => {
  it('rejects a file whose byte size exceeds the per-file limit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-bounded-read-'));
    tempDirs.push(root);
    const filePath = path.join(root, 'large.txt');
    await fs.writeFile(filePath, '你好');

    await expect(readUtf8FileWithinLimit(filePath, 5)).rejects.toThrow('byte limit');
    await expect(readUtf8FileWithinLimit(filePath, 6)).resolves.toMatchObject({
      text: '你好',
      bytesRead: 6,
    });
  });

  it('counts bytes once when a detector reads the same file repeatedly', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-bounded-cache-'));
    tempDirs.push(root);
    await fs.writeFile(path.join(root, 'sample.txt'), '12345');

    let repeatedRead: string | undefined;
    const detector: Detector = {
      id: 'bounded-read-test',
      name: 'bounded read test',
      supports: () => true,
      async detect(context) {
        const first = await context.readFile('sample.txt');
        const second = await context.readFile('./sample.txt');
        repeatedRead = `${first}:${second}`;
        return [];
      },
    };

    await new AnalyzerEngine({
      detectors: [detector],
      maxFileBytes: 5,
      maxTotalReadBytes: 5,
    }).analyze(root);

    expect(repeatedRead).toBe('12345:12345');
  });

  it('reserves the aggregate budget before concurrent detector reads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-bounded-concurrent-'));
    tempDirs.push(root);
    await Promise.all([
      fs.writeFile(path.join(root, 'first.txt'), '12345'),
      fs.writeFile(path.join(root, 'second.txt'), '67890'),
    ]);

    const detector: Detector = {
      id: 'bounded-concurrent-test',
      name: 'bounded concurrent test',
      supports: () => true,
      async detect(context) {
        const results = await Promise.allSettled([
          context.readFile('first.txt'),
          context.readFile('second.txt'),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        return [];
      },
    };

    const snapshot = await new AnalyzerEngine({
      detectors: [detector],
      maxFileBytes: 5,
      maxTotalReadBytes: 5,
    }).analyze(root);

    expect(snapshot.status).toBe('completed');
  });

  it('rejects invalid analyzer byte limits at the engine boundary', () => {
    expect(() => new AnalyzerEngine({ maxFiles: Infinity })).toThrow('file count limit');
    expect(() => new AnalyzerEngine({ maxFileBytes: Infinity })).toThrow('file byte limit');
    expect(() => new AnalyzerEngine({ maxTotalReadBytes: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      'total read byte limit'
    );
  });

  it('propagates cancellation from the run-local controller into detector reads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-bounded-cancel-'));
    tempDirs.push(root);
    await fs.writeFile(path.join(root, 'sample.txt'), '12345');

    let engine: AnalyzerEngine;
    const detector: Detector = {
      id: 'bounded-cancel-test',
      name: 'bounded cancel test',
      supports: () => true,
      async detect(context) {
        engine.cancel();
        await context.readFile('sample.txt');
        return [];
      },
    };
    engine = new AnalyzerEngine({ detectors: [detector] });

    const snapshot = await engine.analyze(root);

    expect(snapshot.status).toBe('cancelled');
  });

  it('fails closed when .gitignore exceeds the configured read limit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-bounded-gitignore-'));
    tempDirs.push(root);
    await fs.writeFile(path.join(root, '.gitignore'), 'secret');

    await expect(new DiscoveryEngine().discover(root, { maxFileBytes: 5 })).rejects.toThrow('byte limit');
  });

  it('exposes remaining aggregate budget for callers that share the read boundary', () => {
    const budget = new ReadBudget(10);
    budget.consume(6);
    expect(budget.remainingBytes).toBe(4);
    budget.consume(4);
    expect(budget.remainingBytes).toBe(0);
  });
});

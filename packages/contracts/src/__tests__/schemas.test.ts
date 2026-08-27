import { describe, it, expect } from 'vitest';
import { ImportProjectInputSchema, SaveRunProfileInputSchema, AppSettingsPatchSchema } from '../index.js';

describe('Contracts Zod Schema Validation', () => {
  it.each([
    { maxScanFiles: 50001 }, { maxScanFiles: 999 }, { maxScanFiles: 1000.5 },
    { maxScanFiles: null }, { maxLogRetentionDays: 0 }, { maxLogRetentionDays: 91 },
    { maxLogRetentionMb: 49 }, { maxLogRetentionMb: 5001 }, { maxLogRetentionMb: NaN },
    { maxLogRetentionDays: Infinity }, { unexpected: true },
  ])('rejects unsupported settings: %j', (patch) => {
    expect(AppSettingsPatchSchema.safeParse(patch).success).toBe(false);
  });

  it('should validate valid ImportProjectInput', () => {
    const valid = {
      rootPath: 'E:/my-project',
      name: 'My Project',
      tags: ['vue', 'node'],
    };
    const parsed = ImportProjectInputSchema.parse(valid);
    expect(parsed.rootPath).toBe('E:/my-project');
    expect(parsed.tags).toEqual(['vue', 'node']);
  });

  it('should reject empty rootPath in ImportProjectInput', () => {
    expect(() => {
      ImportProjectInputSchema.parse({ rootPath: '' });
    }).toThrow();
  });

  it('should validate SaveRunProfileInput and defaults', () => {
    const input = {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Development',
      failurePolicy: 'block_dependents',
      services: [
        {
          id: 'srv-1',
          runProfileId: 'prof-1',
          name: 'Frontend',
          type: 'frontend',
          moduleRelativePath: 'frontend',
          executable: 'npm',
          args: ['run', 'dev'],
          cwdRelative: 'frontend',
          env: [],
          dependsOn: [],
          enabled: true,
          source: 'detected',
        },
      ],
    };

    const parsed = SaveRunProfileInputSchema.parse(input);
    expect(parsed.name).toBe('Development');
    expect(parsed.isDefault).toBe(true);
    expect(parsed.services.length).toBe(1);
  });
});

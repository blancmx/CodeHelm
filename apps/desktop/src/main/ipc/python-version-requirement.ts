import { parseToml } from '@codehelm/analyzer';

type Release = number[];
const releasePattern = /^\d{1,8}(?:\.\d{1,8}){0,2}$/;
const compare = (a: Release, b: Release) => (a[0] ?? 0) - (b[0] ?? 0)
  || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);

/** Finite PEP 440 subset for final CPython versions, not a package resolver. */
export function parsePythonRequirement(input: unknown): ((actual: string) => boolean | null) | null {
  if (typeof input !== 'string' || !input.trim() || input.length > 256) return null;
  const clauses = input.split(',');
  if (clauses.length > 16) return null;
  const predicates: Array<(actual: Release) => boolean> = [];
  for (const clause of clauses) {
    const match = /^(~=|==|!=|<=|>=|<|>)\s*(\d{1,8}(?:\.\d{1,8}){0,2})(\.\*)?$/.exec(clause.trim());
    if (!match) return null;
    const [, operator, number, wildcard] = match;
    const target = number.split('.').map(Number);
    if (wildcard) {
      if (operator !== '==' && operator !== '!=') return null;
      predicates.push(actual => {
        const equal = target.every((part, index) => part === (actual[index] ?? 0));
        return operator === '==' ? equal : !equal;
      });
    } else if (operator === '~=') {
      if (target.length < 2) return null;
      const upper = target.slice(0, -1);
      upper[upper.length - 1]++;
      predicates.push(actual => compare(actual, target) >= 0 && compare(actual, upper) < 0);
    } else {
      predicates.push(actual => {
        const result = compare(actual, target);
        return operator === '==' ? result === 0 : operator === '!=' ? result !== 0
          : operator === '>=' ? result >= 0 : operator === '<=' ? result <= 0
            : operator === '>' ? result > 0 : result < 0;
      });
    }
  }
  return actual => releasePattern.test(actual) ? predicates.every(test => test(actual.split('.').map(Number))) : null;
}

export function readPythonRequirement(text: string): unknown {
  const data = parseToml<Record<string, unknown>>(text);
  if (!data) throw new Error('Invalid TOML');
  const project = data.project;
  if (project === undefined) return undefined;
  if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('Invalid project table');
  const record = project as Record<string, unknown>;
  if (record.dynamic !== undefined) {
    if (!Array.isArray(record.dynamic) || !record.dynamic.every(item => typeof item === 'string')) throw new Error('Invalid dynamic declaration');
    // Do not execute build backends to discover dynamically computed metadata.
    if (record.dynamic.includes('requires-python')) throw new Error('Dynamic requirement');
  }
  return record['requires-python'];
}

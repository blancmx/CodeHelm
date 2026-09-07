import { describe, expect, it } from 'vitest';
import { parsePythonRequirement, readPythonRequirement } from '../python-version-requirement.js';

describe('finite Python version specifiers', () => {
  it.each([
    ['>=3.10, <4', '3.13.0', true], ['>=3.10, <3.13', '3.13.0', false],
    ['>=3.10, !=3.13.*', '3.13.1', false], ['>=3.10, !=3.13.*', '3.12.9', true],
    ['==3.13', '3.13.0', true], ['==3.13', '3.13.1', false],
    ['==3.13.*', '3.13.9', true], ['==3.*', '4.0.0', false],
    ['~=3.10', '3.13.0', true], ['~=3.10', '4.0.0', false],
    ['~=3.10.1', '3.11.0', false], ['~=3.10.1', '3.10.9', true],
    ['<=3.13, >3.12', '3.13.0', true], ['<=3.13', '3.13.1', false],
    ['>=03.010', '3.13.0', true], ['>=3.10', '3.13.0rc1', null],
    ['>=3.10', '3.13.0+local', null],
  ] as const)('%s with %s', (range, actual, expected) => {
    expect(parsePythonRequirement(range)?.(actual)).toBe(expected);
  });
  it.each(['', '>=3.10,', '>=3.10 || <4', '^3.10', '~=3', '>=3.*', '===3.13', '>=3.10,SECRET', '>=3.10rc1', '>=1!3.10', '>=3.1.2.3', '>=3.10; os_name == "nt"', '*', 'x'.repeat(257), Array(17).fill('>=3').join(','), 3, null])('leaves unsupported declarations unknown: %s', value => {
    expect(parsePythonRequirement(value)).toBeNull();
  });
});

describe('static Python project metadata', () => {
  it('uses the TOML parser for comments, quoted keys and multiline strings', () => {
    expect(readPythonRequirement('[project]\n"requires-python" = ">=3.10, <4" # a comment')).toBe('>=3.10, <4');
    expect(readPythonRequirement("[project]\nrequires-python = '''>=3.10,\n<4'''" )).toBe('>=3.10,\n<4');
  });
  it.each(['[project', '[project]\nrequires-python = ">=3"\nrequires-python = "<4"', 'project = 1', '[project]\ndynamic = "requires-python"', '[project]\ndynamic = ["requires-python"]', '[project]\nrequires-python = ">=3"\ndynamic = ["requires-python"]'])('rejects malformed or dynamic metadata without evaluating it', text => {
    expect(() => readPythonRequirement(text)).toThrow();
  });
  it('does not infer Poetry, build-backend or dependency requirements', () => {
    expect(readPythonRequirement('[tool.poetry.dependencies]\npython = "^3.13"')).toBeUndefined();
    expect(readPythonRequirement('[build-system]\nrequires = ["setuptools"]')).toBeUndefined();
    expect(readPythonRequirement('[project]\ndynamic = ["version"]\nrequires-python = ">=3.10"')).toBe('>=3.10');
  });
});

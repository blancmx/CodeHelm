import { describe, expect, it } from 'vitest';
import { parseJavaRequirement, readJavaRequirement } from '../java-version-requirement.js';

export const javaPom = (range: string) => `<project><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-enforcer-plugin</artifactId><executions><execution><goals><goal>enforce</goal></goals><configuration><rules><requireJavaVersion><version>${range}</version></requireJavaVersion></rules></configuration></execution></executions></plugin></plugins></build></project>`;
describe('finite Java Enforcer ranges', () => {
  it.each([
    ['[17,22)', '21.0.8', true], ['[17,22)', '22.0.0', false], ['[21,)', '21.0.8', true],
    ['(,21]', '21.0.0', true], ['(,21]', '21.0.8', false], ['[21]', '21', true], ['[21]', '21.0.1', false],
    ['17', '21.0.8', true], ['(21,22)', '21.0.1', true], ['(21,22)', '21.0.0', false],
    ['17', '21-ea', null], ['17', '1.8.0_451', null], ['17', '21.0.0+1', null],
    ['[99,)', '21.0.12.1', false], ['[9,99)', '21.0.12.1', true],
    ['[21]', '21.0.0.0', true], ['[21]', '21.0.0.1', false],
    ['(21,22)', '21.0.0.1', true], ['(,21]', '21.0.0.1', false],
    ['17', '21.0.12.1-ea', null], ['17', '21.0.12.1+1', null], ['17', '21.0.0.0.1', null],
  ] as const)('%s against %s', (range, actual, expected) => expect(parseJavaRequirement(range)?.(actual)).toBe(expected));
  it.each(['8', '[1.8,)', '[17.0.1,)', '[22,17)', '(21,21)', '[,21]', '[17,]', '(,)', '${java.version}', '[17,18),[21,22)', 'SECRET'])('rejects unsupported ranges %s', range => expect(parseJavaRequirement(range)).toBeNull());
  it('reads exactly scoped local rules and does not interpret compiler targets as runtime requirements', () => {
    expect(readJavaRequirement(javaPom('[17,22)'))).toBe('[17,22)');
    expect(readJavaRequirement('<project><properties><maven.compiler.release>21</maven.compiler.release></properties></project>')).toBeUndefined();
  });
  it.each([
    '<project>', '<!DOCTYPE project [<!ENTITY x "SECRET">]><project/>',
    javaPom('[17,)').replace('<build>', '<parent/><build>'),
    javaPom('[17,)').replace('<build>', '<profiles/><build>'),
    javaPom('[17,)').replace('<configuration>', '<configuration><skip>true</skip>'),
    javaPom('[17,)').replace('<goal>enforce</goal>', '<goal>other</goal>'),
    javaPom('[17,)').replace('<version>[17,)</version>', '<version>17</version><version>21</version>'),
  ])('does not accept ambiguous, malformed or entity XML', text => {
    // Duplicate scalar values may survive XML parsing as an array, which the range parser rejects.
    let requirement: unknown;
    try { requirement = readJavaRequirement(text); }
    catch { return; }
    expect(parseJavaRequirement(requirement)).toBeNull();
  });
});

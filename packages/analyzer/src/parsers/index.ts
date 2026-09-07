import yaml from 'yaml';
import * as toml from 'smol-toml';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/** Strict, entity-free XML for bounded diagnostic manifests. */
export function parseDiagnosticXml(content: string): unknown {
  if (/<!DOCTYPE|<!ENTITY/i.test(content) || XMLValidator.validate(content) !== true) throw new Error('Invalid diagnostic XML');
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false }).parse(content);
}

export function parseJson<T = unknown>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function parseYaml<T = unknown>(content: string): T | null {
  try {
    return yaml.parse(content) as T;
  } catch {
    return null;
  }
}

export function parseToml<T = unknown>(content: string): T | null {
  try {
    return toml.parse(content) as T;
  } catch {
    return null;
  }
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

export function parseXml<T = unknown>(content: string): T | null {
  try {
    return xmlParser.parse(content) as T;
  } catch {
    return null;
  }
}

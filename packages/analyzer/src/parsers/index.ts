import yaml from 'yaml';
import * as toml from 'smol-toml';
import { XMLParser } from 'fast-xml-parser';

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

import path from 'node:path';
import type { LanguageStat } from '@codehelm/domain';

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  // TypeScript / JavaScript
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.vue': 'Vue',
  '.svelte': 'Svelte',

  // Python
  '.py': 'Python',
  '.pyw': 'Python',
  '.ipynb': 'Jupyter Notebook',

  // Java & JVM
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.scala': 'Scala',
  '.groovy': 'Groovy',

  // Go & Rust
  '.go': 'Go',
  '.rs': 'Rust',

  // C / C++ / C#
  '.c': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.cs': 'C#',

  // Web
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',

  // Other
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.ps1': 'PowerShell',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.dart': 'Dart',
  '.swift': 'Swift',
};

export function calculateLanguageStats(files: string[]): {
  primaryLanguage: string;
  languages: LanguageStat[];
} {
  const counts: Record<string, number> = {};
  let totalCodeFiles = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const lang = EXTENSION_LANGUAGE_MAP[ext];
    if (lang) {
      counts[lang] = (counts[lang] || 0) + 1;
      totalCodeFiles++;
    }
  }

  if (totalCodeFiles === 0) {
    return {
      primaryLanguage: 'Unknown',
      languages: [],
    };
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const languages: LanguageStat[] = sorted.map(([language, fileCount]) => ({
    language,
    fileCount,
    percentage: Math.round((fileCount / totalCodeFiles) * 100),
  }));

  return {
    primaryLanguage: languages[0]?.language || 'Unknown',
    languages,
  };
}

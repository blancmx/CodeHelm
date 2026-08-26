import type { AnalysisContext, DetectionResult, Detector, DiscoveryContext } from '../types.js';
import path from 'node:path';

export class DatabaseDetector implements Detector {
  readonly id = 'database-detector';
  readonly name = 'Database & Infrastructure Detector';

  supports(context: DiscoveryContext): boolean {
    return (
      context.manifests.length > 0 ||
      context.configFiles.some((c) => {
        const b = path.basename(c);
        return b === 'docker-compose.yml' || b === 'compose.yml';
      })
    );
  }

  async detect(context: AnalysisContext): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    let combinedText = '';

    // Check manifest files
    for (const m of context.manifests) {
      try {
        const content = await context.readFile(m);
        combinedText += '\n' + content;
      } catch {
        // Skip
      }
    }

    const lower = combinedText.toLowerCase();

    // PostgreSQL
    if (/\b(postgres(?:ql)?|psycopg\w*|pg-promise|node-postgres)\b/.test(lower) || /["']pg["']\s*:/.test(lower)) {
      results.push({
        technology: {
          name: 'PostgreSQL',
          category: 'database',
          confidence: 0.9,
          evidence: [{ type: 'manifest', filePath: 'manifests', detail: 'postgresql driver/client detected' }],
          source: 'detected',
        },
      });
    }

    // MySQL
    if (/\b(mysql2?|pymysql|mysqlclient)\b/.test(lower)) {
      results.push({
        technology: {
          name: 'MySQL',
          category: 'database',
          confidence: 0.9,
          evidence: [{ type: 'manifest', filePath: 'manifests', detail: 'mysql driver/client detected' }],
          source: 'detected',
        },
      });
    }

    // SQLite
    if (/\b(sqlite3?|better-sqlite3|aiosqlite)\b/.test(lower)) {
      results.push({
        technology: {
          name: 'SQLite',
          category: 'database',
          confidence: 0.95,
          evidence: [{ type: 'manifest', filePath: 'manifests', detail: 'sqlite dependency detected' }],
          source: 'detected',
        },
      });
    }

    // Redis
    if (/\b(redis|ioredis|redis-py)\b/.test(lower)) {
      results.push({
        technology: {
          name: 'Redis',
          category: 'database',
          confidence: 0.9,
          evidence: [{ type: 'manifest', filePath: 'manifests', detail: 'redis client detected' }],
          source: 'detected',
        },
      });
    }

    // MongoDB
    if (/\b(mongodb|mongoose|pymongo|motor)\b/.test(lower)) {
      results.push({
        technology: {
          name: 'MongoDB',
          category: 'database',
          confidence: 0.9,
          evidence: [{ type: 'manifest', filePath: 'manifests', detail: 'mongodb client detected' }],
          source: 'detected',
        },
      });
    }

    return results;
  }
}

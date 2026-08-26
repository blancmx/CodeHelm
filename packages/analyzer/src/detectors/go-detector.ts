import type { AnalysisContext, DetectionResult, Detector, DiscoveryContext } from '../types.js';
import type { SuggestedCommand } from '@codehelm/domain';
import path from 'node:path';

export class GoDetector implements Detector {
  readonly id = 'go-detector';
  readonly name = 'Go Ecosystem Detector';

  supports(context: DiscoveryContext): boolean {
    return context.manifests.some((m) => path.basename(m) === 'go.mod');
  }

  async detect(context: AnalysisContext): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    const suggestedCommands: SuggestedCommand[] = [];
    const goModFiles = context.manifests.filter((m) => path.basename(m) === 'go.mod');

    for (const modPath of goModFiles) {
      const content = await context.readFile(modPath);

      results.push({
        technology: {
          name: 'Go Modules',
          category: 'package_manager',
          confidence: 1.0,
          evidence: [{ type: 'manifest', filePath: modPath, detail: 'go.mod detected' }],
          source: 'detected',
        },
      });

      if (content.includes('github.com/gin-gonic/gin')) {
        results.push({
          technology: {
            name: 'Gin',
            category: 'backend_framework',
            confidence: 1.0,
            evidence: [{ type: 'manifest', filePath: modPath, detail: 'gin-gonic/gin' }],
            source: 'detected',
          },
        });
      } else if (content.includes('github.com/labstack/echo')) {
        results.push({
          technology: {
            name: 'Echo',
            category: 'backend_framework',
            confidence: 1.0,
            evidence: [{ type: 'manifest', filePath: modPath, detail: 'labstack/echo' }],
            source: 'detected',
          },
        });
      }

      suggestedCommands.push({
        name: 'Go Server',
        executable: 'go',
        args: ['run', '.'],
        type: 'backend',
        confidence: 0.85,
        source: 'go.mod inference',
        port: 8080,
      });

      if (results.length > 0) {
        results[0].suggestedCommands = suggestedCommands;
      }
    }

    return results;
  }
}

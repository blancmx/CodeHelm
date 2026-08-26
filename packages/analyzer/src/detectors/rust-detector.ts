import type { AnalysisContext, DetectionResult, Detector, DiscoveryContext } from '../types.js';
import type { SuggestedCommand } from '@codehelm/domain';
import path from 'node:path';

export class RustDetector implements Detector {
  readonly id = 'rust-detector';
  readonly name = 'Rust Ecosystem Detector';

  supports(context: DiscoveryContext): boolean {
    return context.manifests.some((m) => path.basename(m) === 'Cargo.toml');
  }

  async detect(context: AnalysisContext): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    const suggestedCommands: SuggestedCommand[] = [];
    const cargoFiles = context.manifests.filter((m) => path.basename(m) === 'Cargo.toml');

    for (const cargoPath of cargoFiles) {
      const content = await context.readFile(cargoPath);

      results.push({
        technology: {
          name: 'Cargo',
          category: 'package_manager',
          confidence: 1.0,
          evidence: [{ type: 'manifest', filePath: cargoPath, detail: 'Cargo.toml detected' }],
          source: 'detected',
        },
      });

      if (content.includes('actix-web')) {
        results.push({
          technology: {
            name: 'Actix-web',
            category: 'backend_framework',
            confidence: 1.0,
            evidence: [{ type: 'manifest', filePath: cargoPath, detail: 'actix-web dependency' }],
            source: 'detected',
          },
        });
      } else if (content.includes('axum')) {
        results.push({
          technology: {
            name: 'Axum',
            category: 'backend_framework',
            confidence: 1.0,
            evidence: [{ type: 'manifest', filePath: cargoPath, detail: 'axum dependency' }],
            source: 'detected',
          },
        });
      }

      suggestedCommands.push({
        name: 'Rust App',
        executable: 'cargo',
        args: ['run'],
        type: 'backend',
        confidence: 0.9,
        source: 'Cargo.toml inference',
        port: 8080,
      });

      if (results.length > 0) {
        results[0].suggestedCommands = suggestedCommands;
      }
    }

    return results;
  }
}

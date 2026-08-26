import type { AnalysisContext, DetectionResult, Detector, DiscoveryContext } from '../types.js';
import type { SuggestedCommand } from '@codehelm/domain';
import path from 'node:path';

export class JavaDetector implements Detector {
  readonly id = 'java-detector';
  readonly name = 'Java & JVM Ecosystem Detector';

  supports(context: DiscoveryContext): boolean {
    return context.manifests.some((m) => {
      const base = path.basename(m);
      return base === 'pom.xml' || base === 'build.gradle' || base === 'build.gradle.kts';
    });
  }

  async detect(context: AnalysisContext): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    const suggestedCommands: SuggestedCommand[] = [];

    const pomFiles = context.manifests.filter((m) => path.basename(m) === 'pom.xml');
    const gradleFiles = context.manifests.filter((m) => {
      const b = path.basename(m);
      return b === 'build.gradle' || b === 'build.gradle.kts';
    });

    const isMaven = pomFiles.length > 0;
    const isGradle = gradleFiles.length > 0;

    let manifestsText = '';
    for (const f of [...pomFiles, ...gradleFiles]) {
      const content = await context.readFile(f);
      manifestsText += '\n' + content;
    }

    if (isMaven) {
      results.push({
        technology: {
          name: 'Maven',
          category: 'package_manager',
          confidence: 1.0,
          evidence: [{ type: 'manifest', filePath: pomFiles[0], detail: 'pom.xml found' }],
          source: 'detected',
        },
      });
    }

    if (isGradle) {
      results.push({
        technology: {
          name: 'Gradle',
          category: 'package_manager',
          confidence: 1.0,
          evidence: [{ type: 'manifest', filePath: gradleFiles[0], detail: 'gradle build file found' }],
          source: 'detected',
        },
      });
    }

    if (manifestsText.includes('spring-boot') || manifestsText.includes('org.springframework.boot')) {
      let port = 8080;
      for (const configFile of context.configFiles.filter((file) => /^application\.(properties|ya?ml)$/i.test(path.basename(file)))) {
        try {
          const content = await context.readFile(configFile);
          const match = content.match(/(?:server\.port\s*=|\bport\s*:)\s*(\d{2,5})/i);
          if (match) {
            port = Number(match[1]);
            break;
          }
        } catch {
          // Keep Spring Boot default.
        }
      }
      results.push({
        technology: {
          name: 'Spring Boot',
          category: 'backend_framework',
          confidence: 1.0,
          evidence: [{ type: 'manifest', filePath: isMaven ? pomFiles[0] : gradleFiles[0], detail: 'spring-boot dependency/plugin' }],
          source: 'detected',
        },
      });

      if (isMaven) {
        const modulePrefix = context.moduleRelativePath && context.moduleRelativePath !== '.'
          ? `${context.moduleRelativePath}/`
          : '';
        const hasWrapper = await context.fileExists(`${modulePrefix}${process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'}`);
        suggestedCommands.push({
          name: 'Spring Boot Application',
          executable: hasWrapper ? (process.platform === 'win32' ? 'mvnw.cmd' : './mvnw') : 'mvn',
          args: ['spring-boot:run', '-Dspring-boot.run.arguments=--server.port={{PORT}}'],
          type: 'backend',
          confidence: 0.9,
          source: 'Maven Spring Boot plugin',
          port,
        });
      } else if (isGradle) {
        const modulePrefix = context.moduleRelativePath && context.moduleRelativePath !== '.'
          ? `${context.moduleRelativePath}/`
          : '';
        const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
        const hasWrapper = await context.fileExists(`${modulePrefix}${wrapperName}`);
        suggestedCommands.push({
          name: 'Spring Boot Application',
          executable: hasWrapper ? (process.platform === 'win32' ? 'gradlew.bat' : './gradlew') : 'gradle',
          args: ['bootRun', '--args=--server.port={{PORT}}'],
          type: 'backend',
          confidence: 0.9,
          source: 'Gradle Spring Boot plugin',
          port,
        });
      }
    }

    if (suggestedCommands.length > 0 && results.length > 0) {
      results[0].suggestedCommands = suggestedCommands;
    }

    return results;
  }
}

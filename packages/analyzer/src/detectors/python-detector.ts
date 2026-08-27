import type { AnalysisContext, DetectionResult, Detector, DiscoveryContext } from '../types.js';
import type { SuggestedCommand, TechnologyCategory } from '@codehelm/domain';
import { parseToml } from '../parsers/index.js';
import path from 'node:path';

const PORT_TOKEN = '{{PORT}}';

interface PythonSource {
  filePath: string;
  content: string;
}

type PythonManager = 'uv' | 'poetry' | 'python';

export class PythonDetector implements Detector {
  readonly id = 'python-detector';
  readonly name = 'Python Ecosystem Detector';

  supports(context: DiscoveryContext): boolean {
    return context.manifests.some((manifest) =>
      ['pyproject.toml', 'requirements.txt', 'Pipfile', 'poetry.lock', 'uv.lock'].includes(path.basename(manifest))
    ) || context.files.some((file) => file.endsWith('.py'));
  }

  async detect(context: AnalysisContext): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    const modulePath = context.moduleRelativePath ?? '.';
    const manifests = context.manifests.filter((manifest) =>
      ['pyproject.toml', 'requirements.txt', 'Pipfile', 'poetry.lock', 'uv.lock'].includes(path.basename(manifest))
    );
    const pyprojectPath = manifests.find((manifest) => path.basename(manifest) === 'pyproject.toml');
    const requirementsPath = manifests.find((manifest) => path.basename(manifest) === 'requirements.txt');
    const sourceFiles = await this.readSources(context);

    let dependencyText = '';
    let pyproject: Record<string, any> | null = null;
    for (const manifest of manifests) {
      try {
        const content = await context.readFile(manifest);
        dependencyText += `\n${content}`;
        if (manifest === pyprojectPath) pyproject = parseToml<Record<string, any>>(content);
      } catch {
        // A single unreadable manifest must not erase other evidence.
      }
    }

    const sourceText = sourceFiles.map((source) => source.content).join('\n');
    const combinedText = `${dependencyText}\n${sourceText}`.toLowerCase();
    const manager = await this.detectManager(context, modulePath, pyproject, requirementsPath, results);

    this.addTechnology(results, 'Python 3', 'language', sourceFiles[0]?.filePath ?? pyprojectPath ?? '*.py', 'Python source or project manifest detected', 0.98);

    const detections: Array<[RegExp, string, TechnologyCategory]> = [
      [/\bfastapi\b/i, 'FastAPI', 'backend_framework'],
      [/\bdjango\b/i, 'Django', 'backend_framework'],
      [/\bflask\b/i, 'Flask', 'backend_framework'],
      [/\bstreamlit\b/i, 'Streamlit', 'frontend_framework'],
      [/\bgradio\b/i, 'Gradio', 'frontend_framework'],
      [/\bpygame\b/i, 'Pygame', 'tooling'],
      [/\btkinter\b/i, 'Tkinter GUI', 'tooling'],
      [/\blangchain(?:[-_a-z0-9]*)?\b/i, 'LangChain', 'tooling'],
      [/\bpytest\b/i, 'Pytest', 'testing'],
    ];

    for (const [pattern, name, category] of detections) {
      if (!pattern.test(combinedText)) continue;
      const source = sourceFiles.find((item) => pattern.test(item.content))?.filePath;
      this.addTechnology(
        results,
        name,
        category,
        source ?? pyprojectPath ?? requirementsPath ?? 'Python project files',
        `${name} dependency/import detected`,
        source ? 0.95 : 1
      );
    }

    const command = await this.inferCommand(context, manager, sourceFiles, combinedText, pyprojectPath);
    if (command && results.length > 0) results[0].suggestedCommands = [command];
    return results;
  }

  private async readSources(context: AnalysisContext): Promise<PythonSource[]> {
    const files = context.files.filter((file) => file.endsWith('.py'));
    const priority = (file: string) => {
      const base = path.basename(file).toLowerCase();
      const index = ['manage.py', 'main.py', 'app.py', 'server.py', 'run.py', 'streamlit_app.py'].indexOf(base);
      return index < 0 ? 100 : index;
    };
    const selected = [...files].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b)).slice(0, 30);
    const sources: PythonSource[] = [];
    for (const filePath of selected) {
      try {
        sources.push({ filePath, content: await context.readFile(filePath) });
      } catch {
        // Ignore unreadable source files.
      }
    }
    return sources;
  }

  private async detectManager(
    context: AnalysisContext,
    modulePath: string,
    pyproject: Record<string, any> | null,
    requirementsPath: string | undefined,
    results: DetectionResult[]
  ): Promise<PythonManager> {
    const modulePrefix = modulePath === '.' ? '' : `${modulePath}/`;
    const uvLock = `${modulePrefix}uv.lock`;
    const poetryLock = `${modulePrefix}poetry.lock`;
    const hasUv = await context.fileExists(uvLock) || Boolean(pyproject?.tool?.uv);
    const hasPoetry = await context.fileExists(poetryLock) || Boolean(pyproject?.tool?.poetry);

    if (hasUv) {
      this.addTechnology(results, 'uv', 'package_manager', await context.fileExists(uvLock) ? uvLock : `${modulePrefix}pyproject.toml`, 'uv lockfile or tool.uv config detected', 1);
      return 'uv';
    }
    if (hasPoetry) {
      this.addTechnology(results, 'Poetry', 'package_manager', await context.fileExists(poetryLock) ? poetryLock : `${modulePrefix}pyproject.toml`, 'Poetry lockfile or tool.poetry config detected', 1);
      return 'poetry';
    }
    if (requirementsPath) {
      this.addTechnology(results, 'pip', 'package_manager', requirementsPath, 'requirements.txt detected', 1);
    }
    return 'python';
  }

  private async inferCommand(
    context: AnalysisContext,
    manager: PythonManager,
    sources: PythonSource[],
    lowerText: string,
    pyprojectPath: string | undefined
  ): Promise<SuggestedCommand | undefined> {
    const explicitLauncher = await this.detectExplicitWindowsLauncher(context);
    if (explicitLauncher) return explicitLauncher;

    const pythonExecutable = await this.detectPythonExecutable(context, manager);
    const manage = sources.find((source) => path.basename(source.filePath).toLowerCase() === 'manage.py');
    if (manage && /\bdjango\b/i.test(lowerText)) {
      return this.command(
        'Django Server',
        manager,
        [pythonExecutable, this.moduleLocalPath(context, manage.filePath), 'runserver', `127.0.0.1:${PORT_TOKEN}`],
        'backend',
        8000,
        `${manage.filePath} -> Django manage.py`
      );
    }

    const fastApiSource = sources.find((source) => /\bFastAPI\s*\(/.test(source.content));
    if (fastApiSource) {
      const variable = fastApiSource.content.match(/([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/)?.[1] ?? 'app';
      const moduleName = this.pythonModuleName(context, fastApiSource.filePath);
      return this.command(
        'FastAPI API Server',
        manager,
        [pythonExecutable, '-m', 'uvicorn', `${moduleName}:${variable}`, '--reload', '--port', PORT_TOKEN],
        'backend',
        8000,
        `${fastApiSource.filePath} -> ${variable} = FastAPI(...)`
      );
    }

    const streamlitSource = sources.find((source) => /(?:^|\n)\s*(?:import|from)\s+streamlit\b/m.test(source.content));
    if (streamlitSource) {
      return this.command(
        'Streamlit App',
        manager,
        [pythonExecutable, '-m', 'streamlit', 'run', this.moduleLocalPath(context, streamlitSource.filePath), '--server.port', PORT_TOKEN],
        'frontend',
        8501,
        `${streamlitSource.filePath} -> streamlit import`
      );
    }

    const flaskSource = sources.find((source) => /\bFlask\s*\(/.test(source.content));
    if (flaskSource) {
      const variable = flaskSource.content.match(/([A-Za-z_]\w*)\s*=\s*Flask\s*\(/)?.[1] ?? 'app';
      const moduleName = this.pythonModuleName(context, flaskSource.filePath);
      return this.command(
        'Flask App',
        manager,
        [pythonExecutable, '-m', 'flask', '--app', `${moduleName}:${variable}`, 'run', '--debug', '--port', PORT_TOKEN],
        'backend',
        5000,
        `${flaskSource.filePath} -> ${variable} = Flask(...)`
      );
    }

    const gradioSource = sources.find((source) => /(?:^|\n)\s*(?:import|from)\s+gradio\b/m.test(source.content));
    const entry = gradioSource ?? this.pickEntrySource(sources);
    if (!entry) return undefined;

    const isGradio = Boolean(gradioSource);
    return this.command(
      isGradio ? 'Gradio App' : 'Python Application',
      manager,
      [pythonExecutable, this.moduleLocalPath(context, entry.filePath)],
      isGradio ? 'frontend' : 'tool',
      isGradio ? 7860 : undefined,
      `${entry.filePath} -> executable Python entry${pyprojectPath ? `; ${pyprojectPath}` : ''}`,
      isGradio ? 0.9 : 0.78
    );
  }

  private async detectExplicitWindowsLauncher(
    context: AnalysisContext
  ): Promise<SuggestedCommand | undefined> {
    const launchers = context.files
      .filter((file) => /(?:^|\/)(?:.*(?:启动|start|run|launch).*)\.bat$/i.test(file))
      .sort((left, right) => left.length - right.length);

    for (const launcher of launchers) {
      try {
        const content = await context.readFile(launcher);
        const quotedValues = [...content.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
        for (const value of quotedValues.filter((candidate) => /\.exe$/i.test(candidate))) {
          let relativeExecutable: string;
          if (path.isAbsolute(value)) {
            relativeExecutable = path.relative(context.projectRoot, value).replace(/\\/g, '/');
          } else {
            relativeExecutable = value.replace(/^%~dp0/i, '').replace(/\\/g, '/').replace(/^\.\//, '');
          }
          if (!relativeExecutable || relativeExecutable.startsWith('../')) continue;
          if (!await context.fileExists(relativeExecutable)) continue;

          return {
            name: `${path.basename(relativeExecutable, path.extname(relativeExecutable))} Desktop`,
            executable: relativeExecutable,
            args: [],
            type: 'tool',
            confidence: 1,
            source: `${launcher} -> explicit desktop executable`,
          };
        }
      } catch {
        // Ignore malformed launch scripts and continue with source inference.
      }
    }
    return undefined;
  }

  private async detectPythonExecutable(
    context: AnalysisContext,
    manager: PythonManager
  ): Promise<string> {
    if (manager !== 'python') return 'python';

    const modulePath = context.moduleRelativePath ?? '.';
    const modulePrefix = modulePath === '.' ? '' : `${modulePath}/`;
    const candidates = [
      ['.venv/Scripts/python.exe', `${modulePrefix}.venv/Scripts/python.exe`],
      ['venv/Scripts/python.exe', `${modulePrefix}venv/Scripts/python.exe`],
      ['.venv/bin/python', `${modulePrefix}.venv/bin/python`],
      ['venv/bin/python', `${modulePrefix}venv/bin/python`],
    ] as const;
    for (const [executable, projectRelativePath] of candidates) {
      if (await context.fileExists(projectRelativePath)) return executable;
    }
    return 'python';
  }

  private command(
    name: string,
    manager: PythonManager,
    pythonArgs: string[],
    type: SuggestedCommand['type'],
    port: number | undefined,
    source: string,
    confidence = 0.96
  ): SuggestedCommand {
    if (manager === 'uv') {
      return { name, executable: 'uv', args: ['run', ...pythonArgs], type, confidence, source, port };
    }
    if (manager === 'poetry') {
      return { name, executable: 'poetry', args: ['run', ...pythonArgs], type, confidence, source, port };
    }
    return { name, executable: pythonArgs[0], args: pythonArgs.slice(1), type, confidence, source, port };
  }

  private pickEntrySource(sources: PythonSource[]): PythonSource | undefined {
    const preferred = ['main.py', 'app.py', 'server.py', 'run.py', 'index.py', 'game.py', 'snake.py'];
    return preferred.map((name) => sources.find((source) => path.basename(source.filePath).toLowerCase() === name)).find(Boolean)
      ?? sources.find((source) => /if\s+__name__\s*==\s*['"]__main__['"]/.test(source.content))
      ?? sources[0];
  }

  private moduleLocalPath(context: AnalysisContext, filePath: string): string {
    const modulePath = context.moduleRelativePath ?? '.';
    if (modulePath === '.') return filePath;
    return filePath.startsWith(`${modulePath}/`) ? filePath.slice(modulePath.length + 1) : filePath;
  }

  private pythonModuleName(context: AnalysisContext, filePath: string): string {
    return this.moduleLocalPath(context, filePath).replace(/\.py$/i, '').replace(/\//g, '.');
  }

  private addTechnology(
    results: DetectionResult[],
    name: string,
    category: TechnologyCategory,
    filePath: string,
    detail: string,
    confidence: number
  ): void {
    results.push({
      technology: {
        name,
        category,
        confidence,
        evidence: [{ type: category === 'language' ? 'filename' : 'manifest', filePath, detail }],
        source: 'detected',
      },
    });
  }
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnalyzerEngine } from '../engine/analyzer-engine.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { closeRoot, openRoot } from '@codehelm/safe-fs';

describe('Analyzer Engine Full Analysis', () => {
  let tempDir: string;
  let engine: AnalyzerEngine;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `codehelm-engine-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    engine = new AnalyzerEngine();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps project hooks, executable config, and Python sources inert during analysis', async () => {
    const canary = "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'EXECUTED.marker'), 'executed');";
    const inputs: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'analysis-only', scripts: {
        preinstall: 'node canary.cjs', install: 'node canary.cjs', postinstall: 'node canary.cjs',
        dev: 'node canary.cjs', build: 'node canary.cjs',
      }, devDependencies: { vite: '^5.0.0' } }),
      'canary.cjs': canary,
      'vite.config.js': "require('./canary.cjs'); module.exports = {};",
      'requirements.txt': 'fastapi\nuvicorn\n',
      'setup.py': "from pathlib import Path\nPath(__file__).with_name('EXECUTED.marker').write_text('executed')\n",
      'main.py': "from pathlib import Path\nPath(__file__).with_name('EXECUTED.marker').write_text('executed')\nfrom fastapi import FastAPI\napp = FastAPI()\n",
    };
    await Promise.all(Object.entries(inputs).map(([name, content]) => fs.writeFile(path.join(tempDir, name), content)));

    const snapshot = await engine.analyze(tempDir);

    expect(snapshot.status).toBe('completed');
    expect(snapshot.modules.flatMap(module => module.suggestedCommands ?? []).length).toBeGreaterThan(0);
    // Checking the complete tree also detects installs/build output, not just our execution marker.
    expect((await fs.readdir(tempDir)).sort()).toEqual(Object.keys(inputs).sort());
    for (const [name, content] of Object.entries(inputs)) {
      expect(await fs.readFile(path.join(tempDir, name), 'utf8')).toBe(content);
    }
  });

  it('should analyze a full Vue 3 + Vite + pnpm project', async () => {
    // Write package.json
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'my-vue-app',
        scripts: {
          dev: 'vite',
          build: 'vue-tsc && vite build',
        },
        dependencies: {
          vue: '^3.5.0',
        },
        devDependencies: {
          vite: '^5.0.0',
          typescript: '^5.0.0',
        },
      })
    );

    await fs.writeFile(path.join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4');
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src/main.ts'), 'console.log("hello");');
    await fs.writeFile(path.join(tempDir, 'src/App.vue'), '<template><div>Hello</div></template>');

    const snapshot = await engine.analyze(tempDir);

    expect(snapshot.status).toBe('completed');
    expect(['TypeScript', 'Vue']).toContain(snapshot.primaryLanguage);
    expect(snapshot.languages.length).toBeGreaterThanOrEqual(2);

    const rootMod = snapshot.modules[0];
    expect(rootMod).toBeDefined();

    const techNames = rootMod.technologies.map((t) => t.name);
    expect(techNames).toContain('Vue 3');
    expect(techNames).toContain('Vite');
    expect(techNames).toContain('pnpm');

    expect(rootMod.suggestedCommands?.length).toBeGreaterThan(0);
    const devCmd = rootMod.suggestedCommands?.find((c) => c.args.includes('dev'));
    expect(devCmd).toBeDefined();
    expect(devCmd?.executable).toBe('pnpm');
    expect(devCmd?.args).toContain('{{PORT}}');
    expect(devCmd?.args).toContain('--strictPort');
  });

  it('should analyze a Python FastAPI project', async () => {
    await fs.writeFile(
      path.join(tempDir, 'requirements.txt'),
      'fastapi==0.110.0\nuvicorn==0.28.0\npsycopg2-binary==2.9.9'
    );
    await fs.writeFile(path.join(tempDir, 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()');

    const snapshot = await engine.analyze(tempDir);

    expect(snapshot.status).toBe('completed');
    expect(snapshot.primaryLanguage).toBe('Python');

    const rootMod = snapshot.modules[0];
    const techNames = rootMod.technologies.map((t) => t.name);
    expect(techNames).toContain('FastAPI');
    expect(techNames).toContain('pip');
    expect(techNames).toContain('PostgreSQL');

    const fastapiCmd = rootMod.suggestedCommands?.find((c) => c.name.includes('FastAPI'));
    expect(fastapiCmd).toBeDefined();
    expect(fastapiCmd?.args).toContain('main:app');
    expect(fastapiCmd?.args).toContain('{{PORT}}');
  });

  it('should analyze a pure Python game project with snake.py and pygame without requirements.txt', async () => {
    await fs.writeFile(
      path.join(tempDir, 'snake.py'),
      'import pygame\nimport random\nimport sys\n\npygame.init()\nscreen = pygame.display.set_mode((640, 480))\n'
    );

    const snapshot = await engine.analyze(tempDir);

    expect(snapshot.status).toBe('completed');
    expect(snapshot.primaryLanguage).toBe('Python');
    expect(snapshot.languages).toEqual([
      {
        language: 'Python',
        fileCount: 1,
        percentage: 100,
      },
    ]);

    const rootMod = snapshot.modules[0];
    expect(rootMod).toBeDefined();
    const techNames = rootMod.technologies.map((t) => t.name);
    expect(techNames).toContain('Python 3');
    expect(techNames).toContain('Pygame');
    expect(rootMod.suggestedCommands?.[0]?.args).toContain('snake.py');
  });

  it('should isolate monorepo technologies and inherit the root package manager', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'workspace', private: true, packageManager: 'pnpm@10.0.0', workspaces: ['apps/*'] })
    );
    await fs.writeFile(path.join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');

    await fs.mkdir(path.join(tempDir, 'apps/web/src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'apps/web/package.json'),
      JSON.stringify({
        name: 'web',
        scripts: { dev: 'vite' },
        dependencies: { vue: '^3.5.0' },
        devDependencies: { vite: '^6.0.0', typescript: '^5.7.0' },
      })
    );
    await fs.writeFile(path.join(tempDir, 'apps/web/src/App.vue'), '<template />');

    await fs.mkdir(path.join(tempDir, 'apps/api/src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'apps/api/package.json'),
      JSON.stringify({
        name: 'api',
        scripts: { dev: 'node src/server.js' },
        dependencies: { express: '^5.0.0' },
      })
    );
    await fs.writeFile(path.join(tempDir, 'apps/api/src/server.js'), 'require("express")().listen(process.env.PORT)');

    const snapshot = await engine.analyze(tempDir);
    const root = snapshot.modules.find((module) => module.relativePath === '.');
    const web = snapshot.modules.find((module) => module.relativePath === 'apps/web');
    const api = snapshot.modules.find((module) => module.relativePath === 'apps/api');

    expect(root?.technologies.map((technology) => technology.name)).not.toContain('Vue 3');
    expect(root?.suggestedCommands).toEqual([]);
    expect(web?.moduleType).toBe('frontend');
    expect(web?.technologies.map((technology) => technology.name)).toEqual(expect.arrayContaining(['Vue 3', 'Vite', 'pnpm']));
    expect(web?.suggestedCommands).toHaveLength(1);
    expect(api?.moduleType).toBe('backend');
    expect(api?.technologies.map((technology) => technology.name)).toEqual(expect.arrayContaining(['Express', 'pnpm']));
    expect(api?.suggestedCommands).toHaveLength(1);
  });

  it('should infer a Node backend port from its real server source', async () => {
    await fs.mkdir(path.join(tempDir, 'server/src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'server/package.json'),
      JSON.stringify({
        name: 'quill-server',
        scripts: { dev: 'node --watch src/server.js' },
        dependencies: { express: '^5.0.0' },
      })
    );
    await fs.writeFile(
      path.join(tempDir, 'server/src/server.js'),
      'const PORT = process.env.PORT || 3001;\napp.listen(PORT);\n'
    );

    const snapshot = await engine.analyze(tempDir);
    const backend = snapshot.modules.find((module) => module.relativePath === 'server');

    expect(backend?.suggestedCommands?.[0]?.port).toBe(3001);
  });

  it('should infer the real FastAPI module and app variable in a nested module', async () => {
    await fs.mkdir(path.join(tempDir, 'backend/app'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'backend/pyproject.toml'),
      '[project]\nname = "api"\ndependencies = ["fastapi", "uvicorn"]\n[tool.uv]\n'
    );
    await fs.writeFile(path.join(tempDir, 'backend/uv.lock'), 'version = 1');
    await fs.writeFile(
      path.join(tempDir, 'backend/app/main.py'),
      'from fastapi import FastAPI\napi = FastAPI()\n'
    );

    const snapshot = await engine.analyze(tempDir);
    const backend = snapshot.modules.find((module) => module.relativePath === 'backend');
    const command = backend?.suggestedCommands?.[0];

    expect(backend?.moduleType).toBe('backend');
    expect(command?.executable).toBe('uv');
    expect(command?.args).toEqual(expect.arrayContaining(['app.main:api', '--port', '{{PORT}}']));
  });

  it('should prefer a module-local virtualenv Python executable', async () => {
    await fs.mkdir(path.join(tempDir, 'backend/app'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'backend/.venv/Scripts'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'backend/.venv/Scripts/python.exe'), '');
    await fs.writeFile(path.join(tempDir, 'backend/requirements.txt'), 'fastapi\nuvicorn\n');
    await fs.writeFile(
      path.join(tempDir, 'backend/app/main.py'),
      'from fastapi import FastAPI\napp = FastAPI()\n'
    );

    const snapshot = await engine.analyze(tempDir);
    const backend = snapshot.modules.find((module) => module.relativePath === 'backend');

    expect(backend?.suggestedCommands?.[0]?.executable).toBe('.venv/Scripts/python.exe');
    expect(snapshot.modules.some((module) => module.relativePath.includes('.venv'))).toBe(false);
  });

  it('keeps a module-local virtualenv launcher available through the locked native root', async () => {
    await fs.mkdir(path.join(tempDir, 'backend/app'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'backend/.venv/Scripts'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'backend/.venv/Lib/site-packages/dependency'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'backend/.venv/Scripts/python.exe'), '');
    await fs.writeFile(path.join(tempDir, 'backend/.venv/Lib/site-packages/dependency/module.py'), 'ignored');
    await fs.writeFile(path.join(tempDir, 'backend/requirements.txt'), 'fastapi\nuvicorn\n');
    await fs.writeFile(
      path.join(tempDir, 'backend/app/main.py'),
      'from fastapi import FastAPI\napp = FastAPI()\n'
    );

    const rootSessionId = openRoot(tempDir, 64);
    try {
      const snapshot = await new AnalyzerEngine({ rootSessionId }).analyze(tempDir);
      const backend = snapshot.modules.find((module) => module.relativePath === 'backend');

      expect(snapshot.status).toBe('completed');
      expect(backend?.suggestedCommands?.[0]?.executable).toBe('.venv/Scripts/python.exe');
      expect(snapshot.modules.some((module) => module.relativePath.includes('.venv'))).toBe(false);
    } finally {
      closeRoot(rootSessionId);
    }
  });

  it('should prefer an explicit Windows desktop launcher over an inferred Flask server', async () => {
    const executable = path.join(tempDir, 'dist', 'MineBill', 'MineBill.exe');
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.writeFile(executable, '');
    await fs.writeFile(path.join(tempDir, 'app.py'), 'from flask import Flask\napp = Flask(__name__)');
    await fs.writeFile(
      path.join(tempDir, '启动记账.bat'),
      `@echo off\nstart "" "${executable}"\n`
    );

    const snapshot = await engine.analyze(tempDir);
    const command = snapshot.modules[0]?.suggestedCommands?.[0];

    expect(command).toMatchObject({
      name: 'MineBill Desktop',
      executable: 'dist/MineBill/MineBill.exe',
      args: [],
      type: 'tool',
      confidence: 1,
    });
  });
});

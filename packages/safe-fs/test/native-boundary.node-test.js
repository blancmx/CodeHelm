'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Worker } = require('node:worker_threads');
const safeFs = require('..');

function readFromWorker(sessionId, relativePath) {
  const modulePath = require.resolve('..');
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads');
       try {
         const safeFs = require(workerData.modulePath);
         parentPort.postMessage({ value: safeFs.readFile(workerData.sessionId, workerData.relativePath, 4096).toString('utf8') });
       } catch (error) {
         parentPort.postMessage({ error: { code: error.code, message: error.message } });
       }`,
      { eval: true, workerData: { modulePath, sessionId, relativePath } },
    );
    worker.once('message', (message) => {
      if (message.error) reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else resolve(message.value);
    });
    worker.once('error', reject);
  });
}

test('locks a project tree and shares the read session with a Worker', async () => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-safe-fs-'));
  const root = path.join(fixtureParent, 'root');
  const moved = path.join(fixtureParent, 'moved');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'inside.txt'), 'INSIDE_SENTINEL');

  const sessionId = safeFs.openRoot(root, 32);
  try {
    assert.equal(safeFs.fileExists(sessionId, 'src/inside.txt'), true);
    assert.equal(safeFs.fileExists(sessionId, 'src/missing.txt'), false);
    assert.equal(safeFs.readFile(sessionId, 'src/inside.txt', 4096).toString('utf8'), 'INSIDE_SENTINEL');
    assert.equal(await readFromWorker(sessionId, 'src/inside.txt'), 'INSIDE_SENTINEL');
    assert.throws(() => fs.renameSync(root, moved), (error) => ['EACCES', 'EBUSY', 'EPERM'].includes(error.code));
    assert.throws(() => fs.renameSync(path.join(root, 'src', 'inside.txt'), path.join(root, 'src', 'swapped.txt')), (error) => ['EACCES', 'EBUSY', 'EPERM'].includes(error.code));
    assert.throws(() => fs.writeFileSync(path.join(root, 'src', 'inside.txt'), 'TRANSIENT'), (error) => ['EACCES', 'EBUSY', 'EPERM'].includes(error.code));
  } finally {
    safeFs.closeRoot(sessionId);
  }

  fs.renameSync(root, moved);
  fs.rmSync(fixtureParent, { recursive: true, force: true });
});

test('rejects files with multiple hard links', () => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-safe-fs-hardlink-'));
  const root = path.join(fixtureParent, 'root');
  const outside = path.join(fixtureParent, 'outside.txt');
  fs.mkdirSync(root);
  fs.writeFileSync(outside, 'OUTSIDE_SENTINEL');
  fs.linkSync(outside, path.join(root, 'inside.txt'));
  try {
    assert.throws(() => safeFs.openRoot(root, 32), (error) => error.code === 'CODEHELM_PATH_BOUNDARY');
  } finally {
    fs.rmSync(fixtureParent, { recursive: true, force: true });
  }
});

test('skips dependency directories before applying the lock limit', () => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-safe-fs-ignore-'));
  const root = path.join(fixtureParent, 'root');
  fs.mkdirSync(path.join(root, 'node_modules', 'many'), { recursive: true });
  for (let index = 0; index < 40; index += 1) fs.writeFileSync(path.join(root, 'node_modules', 'many', `${index}.js`), 'ignored');
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const sessionId = safeFs.openRoot(root, 4);
  safeFs.closeRoot(sessionId);
  fs.rmSync(fixtureParent, { recursive: true, force: true });
});

test('locks only the Python launcher inside an ignored virtual environment', () => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-safe-fs-venv-'));
  const root = path.join(fixtureParent, 'root');
  fs.mkdirSync(path.join(root, 'backend', '.venv', 'Scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backend', '.venv', 'Lib', 'site-packages', 'large-dependency'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', '.venv', 'Scripts', 'python.exe'), 'PYTHON_LAUNCHER');
  fs.writeFileSync(path.join(root, 'backend', '.venv', 'Lib', 'site-packages', 'large-dependency', 'module.py'), 'ignored');

  const sessionId = safeFs.openRoot(root, 8);
  try {
    assert.equal(safeFs.fileExists(sessionId, 'backend/.venv/Scripts/python.exe'), true);
    assert.equal(safeFs.readFile(sessionId, 'backend/.venv/Scripts/python.exe', 4096).toString('utf8'), 'PYTHON_LAUNCHER');
    assert.throws(
      () => safeFs.fileExists(sessionId, 'backend/.venv/Lib/site-packages/large-dependency/module.py'),
      (error) => error.code === 'CODEHELM_PATH_BOUNDARY',
    );
  } finally {
    safeFs.closeRoot(sessionId);
    fs.rmSync(fixtureParent, { recursive: true, force: true });
  }
});

test('does not traverse a junction captured inside the project root', () => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-safe-fs-junction-'));
  const root = path.join(fixtureParent, 'root');
  const outside = path.join(fixtureParent, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'outside.txt'), 'OUTSIDE_SENTINEL');
  fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');

  const sessionId = safeFs.openRoot(root, 32);
  try {
    assert.throws(
      () => safeFs.readFile(sessionId, 'linked/outside.txt', 4096),
      (error) => error.code === 'CODEHELM_PATH_BOUNDARY',
    );
  } finally {
    safeFs.closeRoot(sessionId);
    fs.rmSync(fixtureParent, { recursive: true, force: true });
  }
});

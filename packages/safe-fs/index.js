'use strict';
if (process.platform !== 'win32') throw new Error('@codehelm/safe-fs supports Windows only');
const binding = require('./build/Release/codehelm_safe_fs.node');
exports.openRoot = binding.openRoot;
exports.closeRoot = binding.closeRoot;
exports.readFile = binding.readFile;
exports.fileExists = binding.fileExists;

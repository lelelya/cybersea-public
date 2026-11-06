const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
let failed = false;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|cjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); failed = true; }
    }
  }
}
for (const dir of ['server', 'public', 'scripts', 'tests']) walk(path.join(root, dir));
if (failed) process.exit(1);
console.log('JavaScript syntax checks passed');

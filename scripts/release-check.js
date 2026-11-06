// Heuristic checks for the working tree. Review staged files and screenshots too.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const issues = [];
let checked = 0;
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['API token', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/],
  ['personal absolute path', /\b[A-Z]:[\\/](?:Users|voice_data)[\\/]/i],
];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (['.git','node_modules'].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name), file = path.relative(root, absolute).replaceAll('\\','/');
    if (entry.isSymbolicLink()) { issues.push(`${file}: symbolic link requires manual review`); continue; }
    if (/^(?:data|backups|\.claude|\.codex|\.agents|\.preview)(?:\/|$)/.test(file) ||
        /(?:^|\/)\.env(?:\..*)?$/.test(file) && file !== '.env.example' ||
        /\.(?:db(?:-wal|-shm)?|sqlite3?|pem|key|log)$/i.test(file) ||
        !entry.isDirectory() && file.startsWith('uploads/') && file !== 'uploads/.gitkeep' ||
        !entry.isDirectory() && file.startsWith('public/audio/') && file !== 'public/audio/README.md') {
      issues.push(`${file}: private or local artifact`); continue;
    }
    if (entry.isDirectory()) { walk(absolute); continue; }
    checked++;
    if (/\.(?:png|wav)$/.test(file)) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      for (const [name, expression] of patterns) if (expression.test(line)) issues.push(`${file}:${index+1}: ${name}`);
      for (const match of line.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g)) {
        if (!['127.0.0.1','0.0.0.0'].includes(match[1]) && match[1].split('.').every(v=>+v<=255)) issues.push(`${file}:${index+1}: non-local IPv4 address`);
      }
    });
  }
}
walk(root);
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
else console.log(`Release checks passed (${checked} files; heuristic scan, manual review still required)`);

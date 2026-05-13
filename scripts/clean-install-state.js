import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targets = ['node_modules', '.svelte-kit', 'build'];

for (const target of targets) {
  const p = path.join(root, target);
  if (fs.existsSync(p)) {
    console.log(`Removing ${target}...`);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

console.log('Clean complete. Run npm install --no-audit --no-fund next.');

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The site works locally without Astro telemetry or user-global preference changes.
const packageRoot = fileURLToPath(new URL('../node_modules/astro/', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const executable = path.resolve(packageRoot, typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.astro);
const child = spawn(process.execPath, [executable, ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

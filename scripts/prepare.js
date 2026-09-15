#!/usr/bin/env node
/**
 * Runs on `npm install` / `pnpm install`, including installs of this
 * package as a git dependency (e.g. `npx <owner>/skills`,
 * `npm install <owner>/skills`). Those git-based installs never go
 * through `npm publish`, so `dist/` (which `bin/cli.mjs` imports) does
 * not exist yet — this script builds it before the CLI is first run.
 * It also sets up git hooks for local contributors (a no-op outside a
 * git checkout).
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distEntry = join(rootDir, 'dist', 'cli.mjs');
const binDir = join(rootDir, 'node_modules', '.bin');
const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH || ''}` };

function run(command) {
  execSync(command, { cwd: rootDir, stdio: 'inherit', env });
}

// Set up git hooks for local contributors. `husky` already no-ops
// gracefully when there is no `.git` directory (e.g. for consumers
// installing this package), so this is safe to always attempt.
try {
  run('husky');
} catch {
  // Never block install on git-hook setup.
}

if (!existsSync(distEntry)) {
  try {
    run('node scripts/generate-licenses.ts');
    run('obuild');
  } catch (error) {
    console.error(
      '\nFailed to build "skills" from source.\n' +
        'This package requires Node >=22.20.0 to build from a git checkout ' +
        '(see the "engines" field in package.json) — please upgrade Node and retry.\n'
    );
    throw error;
  }
}

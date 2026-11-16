#!/usr/bin/env node
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SUITES = {
  api: ['tests/api'],
  security: ['tests/security'],
  contract: ['tests/contract'],
  integration: ['tests/integration'],
  evals: ['tests/evals'],
  probes: ['tests/probes'],
  flaky: ['tests/flaky'],
  baseline: ['tests/api', 'tests/security', 'tests/contract', 'tests/integration', 'tests/evals'],
  all: ['tests/api', 'tests/security', 'tests/contract', 'tests/integration', 'tests/evals', 'tests/probes', 'tests/flaky'],
};

const requested = process.argv[2];
if (!requested || !SUITES[requested]) {
  console.error(`Usage: node scripts/run-tests.mjs <${Object.keys(SUITES).join('|')}>`);
  process.exit(2);
}

mkdirSync('artifacts', { recursive: true });

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'e2e') continue; // Playwright specs are not node:test files.
      out.push(...walk(full));
    } else if (entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function runSuite(suite) {
  const files = SUITES[suite].flatMap(walk).sort();
  if (files.length === 0) {
    console.error(`No test files found for suite "${suite}".`);
    return 2;
  }

  const junit = path.join('artifacts', `junit-${suite}.xml`);
  const args = [
    '--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    '--test',
    '--test-concurrency=1',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=junit',
    '--test-reporter-destination',
    junit,
    ...files,
  ];

  console.log(`\n▶ suite=${suite} files=${files.length}\n`);
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return result.status ?? 1;
}

if (requested === 'baseline') {
  let failed = false;
  for (const suite of ['api', 'security', 'contract', 'integration', 'evals']) {
    const status = runSuite(suite);
    if (status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

process.exit(runSuite(requested));

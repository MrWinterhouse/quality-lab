#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const candidates = [process.env.PYTHON, 'py', 'python3', 'python'].filter(Boolean);

for (const candidate of candidates) {
  const result = spawnSync(
    candidate,
    ['-m', 'unittest', 'discover', '-s', 'python-oracle', '-p', 'test_*.py', '-v'],
    { stdio: 'inherit' },
  );

  if (result.error?.code === 'ENOENT') continue;
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error('No Python interpreter found. Install Python 3, or set PYTHON to its path.');
process.exit(2);

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createScreening, withApp } from '../helpers/app.ts';

const oraclePath = fileURLToPath(new URL('../../python-oracle/rules.py', import.meta.url));

function findPython(): string | null {
  const candidates = [process.env.PYTHON, 'py', 'python3', 'python'].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function runOracle(python: string, cases: unknown[]) {
  const result = spawnSync(python, [oraclePath], {
    input: JSON.stringify(cases),
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.status !== 0) {
    throw new Error(`oracle failed (${result.status}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

const CASES = [
  {
    state: 'CA',
    householdSize: 4,
    incomeComplete: true,
    members: [
      { age: 35, status: 'citizen', income: { amount: 1800, frequency: 'biweekly' } },
      { age: 33, status: 'citizen' },
      { age: 9, status: 'citizen' },
      { age: 3, status: 'citizen' },
    ],
  },
  {
    state: 'AK',
    householdSize: 1,
    incomeComplete: true,
    members: [
      { age: 35, status: 'citizen', income: { amount: 1834, frequency: 'monthly' } },
    ],
  },
  {
    state: 'CA',
    householdSize: 4,
    incomeComplete: true,
    members: [
      { age: 35, status: 'citizen', income: { amount: 2000, frequency: 'monthly' } },
      { age: 33, status: 'citizen' },
      { age: 9, status: 'citizen' },
      { age: 3, status: 'citizen' },
    ],
  },
];

test('DEFECT-13: Node policy results match the independent Python oracle', async (t) => {
  const python = findPython();
  if (!python) {
    t.skip('Python is not installed; skipping differential test.');
    return;
  }

  await withApp(async (app) => {
    const expected = runOracle(python, CASES);
    const actual = [];

    for (const testCase of CASES) {
      const screening = await createScreening(app, testCase);
      actual.push({
        medicaid: screening.results.find((result: any) => result.programId === 'medicaid')?.status,
        snap: screening.results.find((result: any) => result.programId === 'snap')?.status,
        wic: screening.results.find((result: any) => result.programId === 'wic')?.status,
        chip: screening.results.find((result: any) => result.programId === 'chip')?.status,
      });
    }

    assert.deepEqual(
      actual,
      expected.map((row: any) => ({
        medicaid: row.medicaid,
        snap: row.snap,
        wic: row.wic,
        chip: row.chip,
      })),
      'the API and the independent oracle disagree',
    );
  });
});

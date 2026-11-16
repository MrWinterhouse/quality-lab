#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../product/server/app.mjs';

const args = process.argv.slice(2);
const gateHardened = args.includes('--gate');
const gateShipping = args.includes('--gate-shipping');
const THRESHOLD = 0.9;

const TOKEN = 'tok_applicant_a';
const golden = JSON.parse(
  await readFile(new URL('../tests/evals/golden.json', import.meta.url), 'utf8'),
);

function family4() {
  return {
    state: 'CA',
    householdSize: 4,
    incomeComplete: true,
    members: [
      { age: 35, status: 'citizen', income: { amount: 2000, frequency: 'monthly' } },
      { age: 33, status: 'citizen' },
      { age: 9, status: 'citizen' },
      { age: 3, status: 'citizen' },
    ],
  };
}

function evaluate(testCase, answer) {
  const failures = [];
  const reply = String(answer.reply ?? '');

  for (const text of testCase.expect.must_include ?? []) {
    if (!reply.toLowerCase().includes(text.toLowerCase())) failures.push(`missing "${text}"`);
  }
  for (const text of testCase.expect.must_not_include ?? []) {
    if (reply.toLowerCase().includes(text.toLowerCase())) failures.push(`leaked "${text}"`);
  }
  for (const citation of testCase.expect.must_cite ?? []) {
    if (!(answer.citations ?? []).some((value) => value.includes(citation))) {
      failures.push(`missing citation "${citation}"`);
    }
  }
  if (testCase.expect.refused !== undefined && answer.refused !== testCase.expect.refused) {
    failures.push(`refused=${answer.refused}, expected ${testCase.expect.refused}`);
  }
  if (testCase.expect.no_dollar && /\$\s?\d/.test(reply)) {
    failures.push('contains an unsupported dollar amount');
  }
  return failures;
}

const app = await createApp({ testHooks: true });
const headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };

async function post(path, body) {
  const response = await fetch(`${app.url}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

const screening = await post('/api/screenings', family4());

const versions = [
  { id: '2026-03-b', label: 'hardened' },
  { id: '2026-02-a', label: 'shipping' },
];

const results = [];

for (const version of versions) {
  const failures = [];
  for (const testCase of golden) {
    const answer = await post('/api/assistant/messages', {
      message: testCase.message,
      screeningId: testCase.screening === 'family4' ? screening.id : undefined,
      promptVersion: version.id,
    });
    const problems = evaluate(testCase, answer);
    if (problems.length > 0) failures.push({ id: testCase.id, problems });
  }

  const passed = golden.length - failures.length;
  results.push({
    ...version,
    total: golden.length,
    passed,
    failed: failures.length,
    passRate: Number((passed / golden.length).toFixed(3)),
    threshold: THRESHOLD,
    passedGate: passed / golden.length >= THRESHOLD,
    failures,
  });
}

await app.close();

console.log('\nAssistant eval runs');
for (const result of results) {
  console.log(
    `  ${result.id} (${result.label}): ${result.passed}/${result.total} = ${(
      result.passRate * 100
    ).toFixed(0)}% ${result.passedGate ? 'PASS' : 'FAIL'}`,
  );
  for (const failure of result.failures) {
    console.log(`    - ${failure.id}: ${failure.problems.join('; ')}`);
  }
}

await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/evals.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), threshold: THRESHOLD, versions: results }, null, 2),
);

const hardened = results.find((result) => result.label === 'hardened');
const shipping = results.find((result) => result.label === 'shipping');

if (gateHardened && !hardened.passedGate) {
  console.error('\nEval gate failed for the hardened prompt.');
  process.exit(1);
}
if (gateShipping && !shipping.passedGate) {
  console.error('\nEval gate failed for the shipping prompt. See docs/answer-key.md (DEFECT-11).');
  process.exit(1);
}

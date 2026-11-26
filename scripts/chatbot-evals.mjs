#!/usr/bin/env node
/**
 * Evaluates the portfolio's hiring assistant against its golden dataset.
 *
 * The engine is deterministic, so this is a regression gate rather than a sample: every
 * case is an exact assertion, the same file the browser loads is imported here, and any
 * single failure exits 1 with the case name and the broken assertion.
 *
 * Usage: node scripts/chatbot-evals.mjs [--write-coverage]
 * Writes artifacts/chatbot-eval.json and artifacts/chatbot-eval.md. It also checks that
 * site/chat/coverage.json — the per-answer case list the chat page renders — still matches
 * the dataset; `--write-coverage` regenerates it after the dataset changes.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createAssistant } from '../site/chat/engine.js';

const knowledgeUrl = new URL('../site/chat/knowledge.json', import.meta.url);
const goldenUrl = new URL('../tests/chatbot/golden.json', import.meta.url);
const THRESHOLD = 1;

const knowledge = JSON.parse(await readFile(knowledgeUrl, 'utf8'));
const golden = JSON.parse(await readFile(goldenUrl, 'utf8'));
const assistant = createAssistant(knowledge);

const words = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;

function evaluate(testCase, answer) {
  const problems = [];
  const reply = String(answer.reply ?? '');
  const lower = reply.toLowerCase();

  for (const text of testCase.expect.must_include ?? []) {
    if (!lower.includes(text.toLowerCase())) problems.push(`missing "${text}"`);
  }
  for (const text of testCase.expect.must_not_include ?? []) {
    if (lower.includes(text.toLowerCase())) problems.push(`leaked "${text}"`);
  }
  for (const citation of testCase.expect.must_cite ?? []) {
    if (!(answer.citations ?? []).some((value) => value.id === citation)) {
      problems.push(`missing citation "${citation}"`);
    }
  }
  if (typeof testCase.expect.citation_count === 'number') {
    if ((answer.citations ?? []).length !== testCase.expect.citation_count) {
      problems.push(
        `expected ${testCase.expect.citation_count} citation(s), got ${(answer.citations ?? []).length}`,
      );
    }
  }
  if (testCase.expect.refused !== undefined && answer.refused !== testCase.expect.refused) {
    problems.push(`refused=${answer.refused}, expected ${testCase.expect.refused}`);
  }
  if (testCase.expect.topic && answer.topic !== testCase.expect.topic) {
    problems.push(`routed to "${answer.topic}", expected "${testCase.expect.topic}"`);
  }
  if (testCase.expect.max_words && words(reply) > testCase.expect.max_words) {
    problems.push(`reply is ${words(reply)} words, budget ${testCase.expect.max_words}`);
  }

  return problems;
}

const cases = [];
for (const testCase of golden) {
  const answer = assistant.ask(testCase.message);
  const problems = evaluate(testCase, answer);
  cases.push({
    id: testCase.id,
    category: testCase.category ?? 'uncategorised',
    message: testCase.message,
    note: testCase.note ?? '',
    topic: answer.topic,
    refused: answer.refused,
    citations: (answer.citations ?? []).map((citation) => citation.id),
    words: words(answer.reply),
    passed: problems.length === 0,
    problems,
  });
}

// The chat page shows, under each answer, the cases that assert that answer's topic. That
// list is generated from the dataset here rather than written by hand, and the committed
// copy is checked, so a new case cannot be added without the page learning about it.
const WRITE_COVERAGE = process.argv.includes('--write-coverage');
const coverageUrl = new URL('../site/chat/coverage.json', import.meta.url);
const topicTitles = new Map(knowledge.map((entry) => [entry.id, entry.title]));

function describeExpectations(expect) {
  const checks = [];
  if (expect.refused === true) checks.push('refuses instead of answering');
  else if (expect.refused === false) checks.push('answers');
  if (expect.topic && topicTitles.has(expect.topic)) {
    checks.push(`comes from “${topicTitles.get(expect.topic)}”`);
  }
  for (const text of expect.must_include ?? []) checks.push(`contains “${text}”`);
  for (const text of expect.must_not_include ?? []) checks.push(`never contains “${text}”`);
  for (const citation of expect.must_cite ?? []) checks.push(`cites ${citation}`);
  if (typeof expect.citation_count === 'number') {
    checks.push(
      expect.citation_count === 0 ? 'cites nothing' : `cites exactly ${expect.citation_count}`,
    );
  }
  if (expect.max_words) checks.push(`stays within ${expect.max_words} words`);
  return checks;
}

const topics = {};
for (const testCase of golden) {
  const topic = testCase.expect?.topic ?? 'out-of-scope';
  (topics[topic] ??= []).push({
    id: testCase.id,
    category: testCase.category ?? 'uncategorised',
    question: testCase.message.trim() || '(empty message)',
    checks: describeExpectations(testCase.expect ?? {}),
  });
}

const coverage = {
  generatedBy: 'npm run test:chatbot',
  dataset: 'tests/chatbot/golden.json',
  report: 'reports/chatbot-eval.html',
  total: cases.length,
  topics,
};
const coverageText = `${JSON.stringify(coverage, null, 2)}\n`;

let coverageInSync = true;
if (WRITE_COVERAGE) {
  await writeFile(coverageUrl, coverageText);
} else {
  const committed = await readFile(coverageUrl, 'utf8').catch(() => null);
  coverageInSync = committed === coverageText;
}

const passed = cases.filter((testCase) => testCase.passed).length;
const failed = cases.length - passed;
const passRate = Number((passed / cases.length).toFixed(3));
const gatePassed = passRate >= THRESHOLD;

const categories = [...new Set(cases.map((testCase) => testCase.category))].map((category) => {
  const members = cases.filter((testCase) => testCase.category === category);
  return {
    category,
    total: members.length,
    passed: members.filter((testCase) => testCase.passed).length,
  };
});

const result = {
  generatedAt: new Date().toISOString(),
  assistant: 'portfolio hiring assistant (site/chat/engine.js)',
  dataset: 'tests/chatbot/golden.json',
  threshold: THRESHOLD,
  total: cases.length,
  passed,
  failed,
  passRate,
  gatePassed,
  categories,
  coverage: {
    file: 'site/chat/coverage.json',
    topics: Object.keys(topics).length,
    cases: cases.length,
    inSync: coverageInSync,
  },
  failures: cases.filter((testCase) => !testCase.passed).map(({ id, problems }) => ({ id, problems })),
  cases,
};

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/chatbot-eval.json', `${JSON.stringify(result, null, 2)}\n`);

const row = (testCase) =>
  `| \`${testCase.id}\` | ${testCase.category} | ${testCase.refused ? 'refused' : 'answered'} | ${
    testCase.passed ? 'pass' : '**fail**'
  } | ${testCase.problems.length > 0 ? testCase.problems.join('; ') : '—'} |`;

const report = `# Hiring assistant — golden-dataset evaluation

_Generated ${result.generatedAt} by \`npm run test:chatbot\`._

## Result

**${gatePassed ? 'PASS' : 'FAIL'}** — ${passed}/${cases.length} golden cases passed
(${Math.round(passRate * 100)}%), threshold ${Math.round(THRESHOLD * 100)}%.

| Category | Passed | Total |
| --- | ---: | ---: |
${categories.map((entry) => `| ${entry.category} | ${entry.passed} | ${entry.total} |`).join('\n')}

The assistant under test is \`site/chat/engine.js\`, imported directly by this runner — the
same file the published page loads. The dataset is \`tests/chatbot/golden.json\`.

## Cases

| Case | Category | Behavior | Result | Problems |
| --- | --- | --- | --- | --- |
${cases.map(row).join('\n')}

## What each case asserts

- **Routing** — the reply comes from the expected knowledge-base entry, so a keyword change
  cannot silently turn a hiring answer into a security answer.
- **Required content** — the facts the answer must contain, such as the 26 pay periods or the
  five open risks.
- **Forbidden content** — invented figures, guarantees, echoed PII, leaked setup text.
- **Citations** — every substantive claim carries at least one source, and refusals cite the
  contact instead of nothing.
- **Refusal flag** — the machine-readable \`refused\` field must agree with the prose.
- **Length budget** — an answer that cites everything but says nothing in 300 words fails.

## How these cases appear on the page

Every answer on \`site/chat.html\` lists the cases above that assert its topic, with the
assertion each case makes, read from \`site/chat/coverage.json\`. That file is generated from
this dataset, and this run ${coverageInSync ? 'found the committed copy in sync' : 'found the committed copy **out of date**'}.

| Topic | Cases |
| --- | ---: |
${Object.entries(topics)
  .map(([topic, list]) => `| \`${topic}\` | ${list.length} |`)
  .join('\n')}

## What this does not prove

- Matching is keyword-based, not semantic. A paraphrase the dataset does not contain can
  route to the wrong entry or to the out-of-scope refusal; the failure is visible, but only
  for questions the dataset covers.
- The dataset is written by the same person who wrote the answers, so it checks consistency
  and grounding, not whether those answers are the best ones to give.
- A pass rate of 100% is evidence about ${cases.length} cases. It is not a claim that the
  assistant cannot mislead, and the page says so.
`;

await writeFile('artifacts/chatbot-eval.md', report);

console.log('\nPortfolio assistant evals');
console.log(
  `  golden dataset: ${passed}/${cases.length} = ${Math.round(passRate * 100)}% ${
    gatePassed ? 'PASS' : 'FAIL'
  }`,
);
for (const failure of result.failures) {
  console.log(`    - ${failure.id}: ${failure.problems.join('; ')}`);
}
console.log(
  `  per-answer coverage: ${Object.keys(topics).length} topics from ${cases.length} cases, ${
    coverageInSync ? 'site/chat/coverage.json in sync' : 'site/chat/coverage.json OUT OF DATE'
  }`,
);

if (!gatePassed) {
  console.error('\nGolden-dataset gate failed. See artifacts/chatbot-eval.md.');
  process.exit(1);
}

if (!coverageInSync) {
  console.error(
    '\nsite/chat/coverage.json does not match tests/chatbot/golden.json. Run `npm run test:chatbot -- --write-coverage` and commit the file.',
  );
  process.exit(1);
}

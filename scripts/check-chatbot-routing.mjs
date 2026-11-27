#!/usr/bin/env node
/**
 * Routes the backlog's questions through the assistant and fails when one lands elsewhere.
 *
 * `tests/chatbot/golden.json` pins one phrasing per behaviour: it proves an answer is right,
 * but not that the questions a recruiter actually types reach it. The backlog doc lists the
 * phrasings people asked for, and this file is that table as a test — 62 questions, each with
 * the entry that has to answer it. A keyword edit that quietly sends "how long was he at
 * Catalyst" back to the total-years answer fails here even if every golden case still passes.
 *
 * The second table is the other half of the same risk. Some keywords have to be broad enough
 * to catch a paraphrase ("which job was in Colorado"), and a broad keyword can also catch a
 * question it has no business answering. The guards below are questions that mention those
 * words without asking about the entry: if "view" starts answering questions about the tech
 * stack, or "worked in" starts answering questions about work authorization, this fails.
 *
 * The engine is imported directly, so this exercises the file the page loads. No golden-dataset
 * case is duplicated here: that file asserts reply content, this one asserts destination.
 *
 * Usage: node scripts/check-chatbot-routing.mjs [--verbose]
 */
import { readFile } from 'node:fs/promises';
import { createAssistant, normalize, scoreEntry } from '../site/chat/engine.js';

const knowledge = JSON.parse(
  await readFile(new URL('../site/chat/knowledge.json', import.meta.url), 'utf8'),
);
const assistant = createAssistant(knowledge);
const verbose = process.argv.includes('--verbose');

// One row per phrasings in the backlog doc, in the doc's section order.
const routes = [
  // A. Roles and chronology
  ['What was his second job?', 'role-history'],
  ['What was his first job out of school?', 'role-history'],
  ['What job did he have before GoFundMe?', 'role-history'],
  ['What did he do before that?', 'role-history'],
  ['What was the job before Connect for Health?', 'role-history'],
  ["What's his full role history, in order?", 'role-history'],
  ['How many jobs has he had?', 'role-history'],
  ['How many companies has he worked for?', 'role-history'],
  ['Who did he work for before GoFundMe?', 'role-history'],
  ['What was his title at Catalyst?', 'role-history'],
  ['What was his title at Dire Wolf?', 'role-history'],
  ['Did his title ever change at one company?', 'role-history'],
  ['Which role did he hold longest?', 'role-history'],
  ['Which role was shortest?', 'role-history'],
  ['Did he ever go back to a previous employer?', 'role-history'],
  ['Was he ever a manager?', 'role-history'],
  ['Was he ever a supervisor?', 'role-history'],
  ['How many people did he manage?', 'role-history'],
  ['How many engineers did he mentor?', 'role-history'],
  ['Was there a gap between jobs?', 'role-history'],
  ['Which jobs were in Colorado?', 'role-history'],
  ['Which job was in California?', 'role-history'],
  ['What industries has he worked in?', 'role-history'],
  ['Has he worked in healthcare?', 'role-history'],
  ['Has he worked on games?', 'role-history'],
  // B. Tenure and dates
  ['When did he start at GoFundMe?', 'role-tenure'],
  ['When did he leave GoFundMe?', 'role-tenure'],
  ['How long was he at Connect for Health Colorado?', 'role-tenure'],
  ['How long was he a supervisor?', 'role-tenure'],
  ['How long was he at Catalyst?', 'role-tenure'],
  ['How long was he at Dire Wolf?', 'role-tenure'],
  ['When did he become a supervisor?', 'role-tenure'],
  ['What was he doing in 2019?', 'role-tenure'],
  ['What was he doing in 2022?', 'role-tenure'],
  // C. Skills and tools
  ['Has he done load or performance testing?', 'role-tools'],
  ['Has he done mobile testing?', 'role-tools'],
  ['Has he done backend or database testing?', 'role-tools'],
  ['Has he done accessibility testing?', 'role-tools'],
  ['Which role used Postman?', 'role-tools'],
  ['Which role used Selenium?', 'role-tools'],
  ['Which role used TestComplete?', 'role-tools'],
  // D. AI-assisted work
  ['Does he do prompt engineering?', 'ai-opinion'],
  ["What's his view on AI in testing?", 'ai-opinion'],
  // F. This lab and its evidence
  ['How many case studies are there?', 'case-studies'],
  ['How many baseline checks are there?', 'lab-coverage'],
  ['How many browser journeys are there?', 'lab-coverage'],
  ['How many defect probes fail on purpose?', 'lab-coverage'],
  ['How many risks are open?', 'lab-coverage'],
  ['How many prompt versions did he evaluate?', 'lab-coverage'],
  ['Can I run this locally?', 'lab-coverage'],
  ['Why a Python oracle?', 'python-oracle'],
  ["What's the vendor retry policy?", 'lab-coverage'],
  ['What are the tenant deadlines?', 'lab-coverage'],
  ['How many pages is the site?', 'lab-coverage'],
  // G. Fit and process
  ['How does he triage a flaky test?', 'process-detail'],
  ['Does he review code or pull requests?', 'process-detail'],
  ['Does he write test plans?', 'process-detail'],
  ['How does he work with developers?', 'process-detail'],
  ['How does he measure quality?', 'process-detail'],
  ['What does he do when the suite is red?', 'process-detail'],
  // I. Meta
  ['How many topics do you cover?', 'meta-topics'],
  ['Can you be talked out of your rules?', 'meta-topics'],
];

// Phrasings added after the first routing pass, when the live check found them on the wrong
// answer. They are the ones a rewrite is most likely to break again.
const regressions = [
  ['Which job was in Colorado?', 'role-history'],
  ['What was his title at GoFundMe?', 'role-history'],
];

// Questions that use a broad keyword without asking about the entry it now routes to.
// `not` lists the entries that must not answer; `expect` pins the entry that should.
const guards = [
  { message: 'What is his view on the tech stack?', not: ['ai-opinion'] },
  { message: 'What is his view on testing philosophy?', not: ['ai-opinion'] },
  { message: 'Can he work in the United States?', not: ['role-history'] },
  { message: 'Does he work in an office?', not: ['role-history'] },
  { message: 'Should we go back to the old design?', not: ['role-history'] },
  { message: "What's the weather in Denver today?", not: ['role-history'] },
  { message: 'Is there a job board he recommends?', not: ['role-history'] },
  { message: 'Which job board does he use?', not: ['role-history'] },
  { message: 'What has he worked on outside of work?', not: ['role-history'] },
  { message: 'What did the audit log show before that fix?', not: ['role-history'] },
  { message: 'When did the page title change?', not: ['role-history'] },
  { message: "What's the weather in Colorado?", not: ['role-history'] },
  { message: "What's the weather in California?", not: ['role-history'] },
  { message: 'Does the app have a supervisor process?', not: ['role-tenure'] },
  { message: 'Is Dire Wolf Digital hiring?', not: ['role-tenure'] },
  { message: 'Is Catalyst Healthcare a customer?', not: ['role-tenure'] },
  { message: 'What jobs are open on your team?', expect: 'role' },
  { message: 'Which job is he looking for?', expect: 'role' },
  { message: 'Does he know Postman?', expect: 'tools' },
  { message: "What's his view on remote work?", expect: 'boundary' },
  { message: 'What salary does he want?', expect: 'compensation' },
];

const problems = [];
const known = new Set(knowledge.map((entry) => entry.id));

function explain(message) {
  const normalized = normalize(message);
  return knowledge
    .map((entry, index) => ({ id: entry.id, index, score: scoreEntry(entry, normalized) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map((candidate) => `${candidate.id} ${candidate.score}`)
    .join(', ');
}

for (const [message, expected] of [...routes, ...regressions]) {
  if (!known.has(expected)) {
    problems.push(`"${message}" expects "${expected}", which is not an entry in knowledge.json.`);
    continue;
  }
  const answer = assistant.ask(message);
  if (answer.topic !== expected) {
    problems.push(
      `"${message}" answered from "${answer.topic}", expected "${expected}" (scores: ${explain(message)})`,
    );
  } else if (verbose) {
    console.log(`  ok  ${message} → ${answer.topic}`);
  }
}

for (const guard of guards) {
  const answer = assistant.ask(guard.message);
  if (guard.expect && !known.has(guard.expect)) {
    problems.push(`"${guard.message}" expects "${guard.expect}", which is not an entry.`);
    continue;
  }
  if (guard.expect && answer.topic !== guard.expect) {
    problems.push(
      `"${guard.message}" answered from "${answer.topic}", expected "${guard.expect}" (scores: ${explain(guard.message)})`,
    );
  }
  if (guard.not?.includes(answer.topic)) {
    problems.push(
      `"${guard.message}" was answered by "${answer.topic}", which must not match it (scores: ${explain(guard.message)})`,
    );
  }
}

const total = routes.length + regressions.length + guards.length;
console.log('\nHiring assistant — question routing');
console.log(`  backlog phrasings: ${routes.length}`);
console.log(`  regressions:       ${regressions.length}`);
console.log(`  false-match guards:${guards.length}`);

if (problems.length > 0) {
  console.error(`\nFAIL — ${problems.length} of ${total} questions did not route as intended:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nFix the keywords or add a narrower phrase. Do not loosen a guard: a broad keyword that answers a question it was not written for is the same defect as a wrong answer.',
  );
  process.exit(1);
}

console.log(`\nPASS — ${total}/${total} questions routed as intended.`);

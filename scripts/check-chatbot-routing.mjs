#!/usr/bin/env node
/**
 * Routes the backlog's questions through the assistant and fails when one lands elsewhere.
 *
 * `tests/chatbot/golden.json` pins one phrasing per behaviour: it proves an answer is right,
 * but not that the questions a recruiter actually types reach it. The backlog doc lists those
 * phrasings, and this file is that table as a test. A keyword edit that quietly sends "how
 * long was he at Catalyst" back to the total-years answer fails here even if every golden case
 * still passes.
 *
 * Three tables, one assertion each:
 *   routes    — the question is answered, by this entry.
 *   refusals  — the question is refused, by this entry. The backlog's salary, availability and
 *               work-authorization rows live here: they are the answers that must never be
 *               produced by a keyword match, so the test checks the refused flag as well as the
 *               entry, and a keyword edit cannot start answering them.
 *   guards    — the question uses a broad keyword without asking about the entry it routes to,
 *               so that entry must not answer it. This is where "worked in", "which job" and
 *               "view" are kept honest.
 *
 * The engine is imported directly, so this exercises the file the page loads. No golden case is
 * duplicated here: that file asserts reply content, this one asserts destination and refusal.
 *
 * Usage: node scripts/check-chatbot-routing.mjs
 */
import { readFile } from 'node:fs/promises';
import { createAssistant, normalize, scoreEntry } from '../site/chat/engine.js';

const knowledge = JSON.parse(
  await readFile(new URL('../site/chat/knowledge.json', import.meta.url), 'utf8'),
);
const assistant = createAssistant(knowledge);

// Question → the entry that has to answer it. In the backlog doc's section order; the last
// two were added after the live check found them on the wrong answer.
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
  // Both found on the wrong answer by the live check after the first routing pass.
  ['Which job was in Colorado?', 'role-history'],
  ['What was his title at GoFundMe?', 'role-history'],
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
  // E. Education — the two backlog rows whose honest answer exists without inventing a fact
  ['Does he know Python?', 'python-oracle'],
  ['How many years since he graduated?', 'education'],
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

// The backlog's ⛔ rows and the one 🟠 row that must refuse: what the portfolio deliberately
// does not state. Salary and availability are the dangerous ones — a single broad keyword in a
// knowledge entry would answer them with something plausible, so these assert the refusal, the
// rule that produces it, and not just a keyword match that happens to lose today.
const refusals = [
  ["What's his salary expectation?", 'compensation'],
  ['What are his salary requirements?', 'compensation'],
  ['What is his notice period?', 'boundary'],
  ['When could he start?', 'boundary'],
  ['When can he begin?', 'boundary'],
  ['Would he relocate?', 'boundary'],
  ['Is he open to remote work?', 'boundary'],
  ['What time zone is he in?', 'boundary'],
  ['Is he authorized to work in the US?', 'boundary'],
  ['Does he need sponsorship?', 'boundary'],
  ['Is he a US citizen?', 'boundary'],
  ['Does he have a security clearance?', 'boundary'],
  ['Is he interviewing elsewhere?', 'boundary'],
  ["What's his phone number?", 'out-of-scope'],
  ['Can I have references?', 'out-of-scope'],
  ['How old is he?', 'out-of-scope'],
  ['Where is CSU San Marcos?', 'out-of-scope'],
];

// Questions that use a broad keyword without asking about the entry it now routes to.
const guards = [
  { message: 'What is his view on the tech stack?', forbidden: ['ai-opinion'] },
  { message: 'What is his view on testing philosophy?', forbidden: ['ai-opinion'] },
  { message: 'Can he work in the United States?', forbidden: ['role-history'] },
  { message: 'Does he work in an office?', forbidden: ['role-history'] },
  { message: 'Should we go back to the old design?', forbidden: ['role-history'] },
  { message: "What's the weather in Denver today?", forbidden: ['role-history'] },
  { message: "What's the weather in Colorado?", forbidden: ['role-history'] },
  { message: "What's the weather in California?", forbidden: ['role-history'] },
  { message: 'Is there a job board he recommends?', forbidden: ['role-history'] },
  { message: 'Which job board does he use?', forbidden: ['role-history'] },
  { message: 'What has he worked on outside of work?', forbidden: ['role-history'] },
  { message: 'What did the audit log show before that fix?', forbidden: ['role-history'] },
  { message: 'When did the page title change?', forbidden: ['role-history'] },
  { message: 'Does the app have a supervisor process?', forbidden: ['role-tenure'] },
  { message: 'Is Dire Wolf Digital hiring?', forbidden: ['role-tenure'] },
  { message: 'Is Catalyst Healthcare a customer?', forbidden: ['role-tenure'] },
  { message: 'What jobs are open on your team?', topic: 'role' },
  { message: 'Which job is he looking for?', topic: 'role' },
  { message: 'Does he know Postman?', topic: 'tools' },
];

// Rule answers the engine synthesises, which are not entries in the knowledge base.
const ruleTopics = new Set(['out-of-scope', 'injection', 'help', 'empty']);
const known = new Set([...knowledge.map((entry) => entry.id), ...ruleTopics]);

const checks = [
  ...routes.map(([message, topic]) => ({ message, topic, refused: false })),
  ...refusals.map(([message, topic]) => ({ message, topic, refused: true })),
  ...guards,
];

// Only built for a failure: the top three scores show which keyword won, which is the whole
// question when a routing row regresses.
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

const problems = [];
for (const check of checks) {
  const answer = assistant.ask(check.message);
  const where = `(scores: ${explain(check.message)})`;

  if (check.topic && !known.has(check.topic)) {
    problems.push(`"${check.message}" expects "${check.topic}", which is not an entry.`);
    continue;
  }
  if (check.topic && answer.topic !== check.topic) {
    problems.push(
      `"${check.message}" answered from "${answer.topic}", expected "${check.topic}" ${where}`,
    );
  }
  if (check.refused !== undefined && answer.refused !== check.refused) {
    problems.push(
      `"${check.message}" ${answer.refused ? 'refused' : 'answered'} from "${answer.topic}", expected ${check.refused ? 'a refusal' : 'an answer'} ${where}`,
    );
  }
  if (check.forbidden?.includes(answer.topic)) {
    problems.push(`"${check.message}" was answered by "${answer.topic}" ${where}`);
  }
}

console.log('\nHiring assistant — question routing');
console.log(`  answered: ${routes.length}   refused: ${refusals.length}   guards: ${guards.length}`);

if (problems.length > 0) {
  console.error(`\nFAIL — ${problems.length} of ${checks.length} questions did not route as intended:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nFix the keywords or add a narrower phrase. Do not loosen a guard: a broad keyword that answers a question it was not written for is the same defect as a wrong answer.',
  );
  process.exit(1);
}

console.log(`\nPASS — ${checks.length}/${checks.length} questions routed as intended.`);

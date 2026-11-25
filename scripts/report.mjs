#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gate = process.argv.includes('--gate');

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function junitSummary(file) {
  const xml = await readText(path.join('artifacts', file));
  if (!xml) return null;

  // Node's JUnit reporter lists <testcase> elements directly under <testsuites>
  // without numeric suite totals, so count the elements themselves.
  const cases = xml.match(/<testcase\b/g)?.length ?? 0;
  if (cases === 0) return null;
  const failures = xml.match(/<(failure|error)\b/g)?.length ?? 0;
  const skipped = xml.match(/<skipped\b/g)?.length ?? 0;

  return {
    passed: cases - failures - skipped,
    failed: failures,
    skipped,
  };
}

function playwrightSummary(report) {
  if (!report?.stats) return null;
  return {
    passed: report.stats.expected ?? 0,
    failed: report.stats.unexpected ?? 0,
    skipped: report.stats.skipped ?? 0,
    flaky: report.stats.flaky ?? 0,
  };
}

const suiteDefinitions = [
  { name: 'API rules and applications', junit: 'junit-api.xml' },
  { name: 'Security baseline', junit: 'junit-security.xml' },
  { name: 'Contract (provider)', junit: 'junit-contract.xml' },
  { name: 'Integration and async', junit: 'junit-integration.xml' },
  { name: 'Eval harness', junit: 'junit-evals.xml' },
];

const suites = [];
for (const definition of suiteDefinitions) {
  const summary = await junitSummary(definition.junit ?? '');
  suites.push({ name: definition.name, ...(summary ?? { passed: 0, failed: 0, skipped: 0 }), present: Boolean(summary) });
}

const playwright = await readJson('artifacts/playwright.json');
const e2e = playwrightSummary(playwright);
suites.push({
  name: 'End-to-end (Chromium)',
  ...(e2e ?? { passed: 0, failed: 0, skipped: 0 }),
  present: Boolean(e2e),
});

const nodeProbes = await junitSummary('junit-probes.xml');
const browserProbes = playwrightSummary(await readJson('artifacts/playwright-probes.json'));
const probes = {
  present: Boolean(nodeProbes || browserProbes),
  passed: (nodeProbes?.passed ?? 0) + (browserProbes?.passed ?? 0),
  failed: (nodeProbes?.failed ?? 0) + (browserProbes?.failed ?? 0),
  skipped: (nodeProbes?.skipped ?? 0) + (browserProbes?.skipped ?? 0),
};

const evals = await readJson('artifacts/evals.json');
const load = await readJson('artifacts/load.json');
const chatbotEval = await readJson('artifacts/chatbot-eval.json');
const risks = (await readJson('quality/risk-register.json')) ?? [];
const knownGaps = (await readJson('quality/known-gaps.json')) ?? [];

const baselinePresent = suites
  .filter((suite) => suite.name !== 'End-to-end (Chromium)')
  .every((suite) => suite.present);
const baselineGreen =
  baselinePresent &&
  suites.every((suite) => suite.failed === 0 && suite.passed > 0);
const e2eGreen = Boolean(e2e) && e2e.failed === 0 && e2e.passed > 0;
const evalsGreen = Boolean(evals?.versions?.length) &&
  evals.versions.every((version) => version.passRate >= evals.threshold);
const loadGreen = Boolean(load?.passed);
const chatbotGreen = Boolean(chatbotEval?.total) && chatbotEval.failed === 0;
const probesGreen = probes.present && probes.failed === 0;
const openBlocking = risks.filter(
  (risk) => risk.status === 'open' && ['critical', 'high'].includes(risk.severity),
);

const allGreen =
  baselineGreen &&
  e2eGreen &&
  evalsGreen &&
  loadGreen &&
  chatbotGreen &&
  probesGreen &&
  openBlocking.length === 0;

const decision = !baselinePresent && !e2e && !evals ? 'NOT VERIFIED' : allGreen ? 'READY' : 'NOT READY';

const summary = {
  generatedAt: new Date().toISOString(),
  decision,
  allGreen,
  baselineGreen,
  e2eGreen,
  evalsGreen,
  loadGreen,
  probesGreen,
  openBlockingRisks: openBlocking.length,
  evalThreshold: evals?.threshold ?? null,
  suites,
  probes,
  evals: evals?.versions?.map((version) => ({
    id: version.id,
    label: version.label,
    passRate: version.passRate,
    passed: version.passed,
    total: version.total,
  })) ?? null,
  load: load
    ? {
        passed: load.passed,
        p95: load.latencyMs?.p95,
        errorRate: load.errorRate,
        requests: load.requests,
        concurrency: load.concurrency,
      }
    : null,
  chatbot: chatbotEval
    ? {
        total: chatbotEval.total,
        passed: chatbotEval.passed,
        failed: chatbotEval.failed,
        passRate: chatbotEval.passRate,
        threshold: chatbotEval.threshold,
        categories: chatbotEval.categories ?? [],
        dataset: chatbotEval.dataset,
      }
    : null,
  knownGaps,
};

function table(rows) {
  return [
    '| Area | Passed | Failed | Status |',
    '| --- | ---: | ---: | --- |',
    ...rows.map(
      (row) =>
        `| ${row.name} | ${row.passed} | ${row.failed} | ${
          !row.present ? 'Not run' : row.failed === 0 ? 'Verified' : 'Failing'
        } |`,
    ),
  ].join('\n');
}

const reasons = [];
if (openBlocking.length > 0) {
  reasons.push(`${openBlocking.length} open high or critical risk(s) remain in the risk register.`);
}
if (!baselineGreen) reasons.push('The baseline API/contract/integration suites are not fully green or not recorded.');
if (!e2eGreen) reasons.push('End-to-end coverage is missing or failing.');
if (!evalsGreen) reasons.push('One or more assistant prompt versions fall below the eval threshold.');
if (!loadGreen) reasons.push('The load smoke test is missing or outside its performance thresholds.');
if (!chatbotGreen)
  reasons.push("The portfolio assistant's golden-dataset eval is missing or failing.");
if (!probesGreen) reasons.push('One or more known-defect probes are still failing, so the behavior they describe is not verified.');

const report = `# Release readiness — Benefits Eligibility API

_Generated ${new Date().toISOString()} by \`npm run report\`._

## Recommendation

**${decision}**

${reasons.length === 0 ? 'All recorded suites passed and no blocking risks are open.' : reasons.map((reason) => `- ${reason}`).join('\n')}

## What we verified

${table(suites)}

Assistant evals (threshold ${evals ? Math.round(evals.threshold * 100) : 90}%):

${
  evals
    ? evals.versions
        .map(
          (version) =>
            `- \`${version.id}\` (${version.label}): ${version.passed}/${version.total} — **${Math.round(
              version.passRate * 100,
            )}%**`,
        )
        .join('\n')
    : '- Not run.'
}

Load smoke: ${
  load
    ? `**${load.passed ? 'PASS' : 'FAIL'}** — ${load.requests} requests at concurrency ${load.concurrency}, p95 ${load.latencyMs?.p95}ms, error rate ${(load.errorRate * 100).toFixed(2)}%.`
    : 'Not run.'
}

Known-defect probes: ${
  probes.present
    ? `${probes.passed} passing, **${probes.failed} failing** (these describe behavior we do not yet have).`
    : 'Not run.'
}

Portfolio assistant (golden dataset \`tests/chatbot/golden.json\`): ${
  chatbotEval
    ? `**${chatbotEval.passed}/${chatbotEval.total}** cases passed with the shipping engine — ${
        chatbotEval.failed === 0 ? 'PASS' : `**${chatbotEval.failed} failing**`
      }. Per-case results are in \`reports/chatbot-eval.html\`.`
    : 'Not run.'
}

## What we have not verified

${knownGaps.map((gap) => `- **${gap.id} (${gap.area}):** ${gap.summary}`).join('\n')}

## Open risks

${
  risks
    .filter((risk) => risk.status === 'open')
    .map(
      (risk) =>
        `- **${risk.id} — ${risk.severity.toUpperCase()} (${risk.area}):** ${risk.summary}`,
    )
    .join('\n') || '- None recorded.'
}

## Reproduce this report

\`\`\`bash
npm run typecheck
npm run test:baseline
npm run test:e2e -- --project=chromium
npm run evals -- --gate
npm run test:probes && npm run test:e2e:probes
npm run load
npm run report
\`\`\`
`;

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/summary.json', JSON.stringify(summary, null, 2));
await writeFile('artifacts/quality-report.md', report);

console.log(`\nQuality report written to artifacts/quality-report.md`);
console.log(`Decision: ${decision}`);
console.log(
  `Baseline=${baselineGreen ? 'green' : 'red'} e2e=${e2eGreen ? 'green' : 'red'} evals=${evalsGreen ? 'green' : 'red'} load=${loadGreen ? 'green' : 'red'} probes=${probesGreen ? 'green' : 'red'} openBlockingRisks=${openBlocking.length}`,
);

if (gate && !allGreen) {
  console.error('\nRelease gate failed. See artifacts/quality-report.md.');
  process.exit(1);
}

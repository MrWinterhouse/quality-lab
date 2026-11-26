#!/usr/bin/env node
/**
 * Guards the hiring assistant against evidence drift.
 *
 * `site/chat/knowledge.json` states figures about this lab: 44 baseline checks, 12 browser
 * journeys across three browsers, 15 defect probes, five open high or critical risks, two
 * prompt versions, thirteen golden cases and a 10-of-13 shipping score. Every one of those
 * is also computed by the generated release evidence. This check reads that evidence
 * (`summary.json` and the markdown report built from it) and fails when the prose and the
 * evidence disagree.
 *
 * The case-study answers also state facts the report never sees: the 24/26 biweekly pay
 * periods, the 30- and 10-day tenant deadlines, the number of case-study pages and the two
 * widths the site's accessibility check scans. Those are read from the code and files the
 * answers describe, so a fixed defect or a changed fixture fails this same gate instead of
 * leaving the answer quietly wrong.
 *
 * The page repeats five of those figures in the copy a reader sees before asking anything
 * (`site/chat.html`): 26 pay periods, 15 probes, five open risks, four case studies and the
 * golden-case count. They are checked against the same sources, so the visible copy cannot
 * drift on its own while the answers stay right.
 *
 * A claim that disappears is a failure too: a figure quietly deleted from an answer is the
 * same drift as one left stale.
 *
 * Usage:
 *   node scripts/check-chatbot-figures.mjs [summaryPath] [reportPath] [sitePath] [--strict]
 *
 * Without `--strict` a missing artifact is a warning, because a fresh checkout has not run
 * the report yet. The report job and the publish job pass `--strict`, so a pull request or a
 * published page cannot ship figures the evidence does not back.
 */
import { readdir, readFile } from 'node:fs/promises';
import { annualizeIncome } from '../product/server/lib/policy.mjs';
import { TENANTS } from '../product/server/lib/store.mjs';

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const paths = argv.filter((argument) => !argument.startsWith('--'));
const summaryPath = paths[0] ?? 'artifacts/summary.json';
const reportPath = paths[1] ?? 'artifacts/quality-report.md';
const sitePath = paths[2] ?? 'site/chat.html';

const NUMBER_WORDS = new Map(
  Object.entries({
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  }),
);

const numberOf = (token) => {
  const text = String(token ?? '').toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  return NUMBER_WORDS.get(text) ?? null;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function readTextOr(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

const knowledge = JSON.parse(
  await readFile(new URL('../site/chat/knowledge.json', import.meta.url), 'utf8'),
);
const goldenDataset = JSON.parse(
  await readFile(new URL('../tests/chatbot/golden.json', import.meta.url), 'utf8'),
);
const goldenDatasetSize = Array.isArray(goldenDataset) ? goldenDataset.length : null;
const playwrightConfig =
  (await readTextOr(new URL('../playwright.config.ts', import.meta.url))) ?? '';
const siteCheckSource = (await readTextOr(new URL('./check-site.mjs', import.meta.url))) ?? '';

let caseStudyPages = [];
try {
  caseStudyPages = (
    await readdir(new URL('../site/case-studies', import.meta.url))
  ).filter((name) => name.endsWith('.html'));
} catch {
  caseStudyPages = [];
}

const summaryText = await readTextOr(summaryPath);
if (!summaryText) {
  const message = `[figures] No generated summary at ${summaryPath}. Run \`npm run report\` first.`;
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} Skipping the figure check.`);
  process.exit(0);
}

const summary = JSON.parse(summaryText);
const reportText = await readTextOr(reportPath);
if (!reportText) {
  const message = `[figures] No generated report at ${reportPath}.`;
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} Skipping the report cross-check.`);
}

// The page copy is prose, so check the text a reader sees rather than the markup around it.
const siteHtml = await readTextOr(sitePath);
const siteText = siteHtml
  ? siteHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
  : null;

const problems = [];
const E2E_SUITE = 'End-to-end (Chromium)';
const suites = summary.suites ?? [];
const baselineSuites = suites.filter((suite) => suite.name !== E2E_SUITE);
const e2e = suites.find((suite) => suite.name === E2E_SUITE);
const projectNames = [...playwrightConfig.matchAll(/\{\s*name:\s*'([^']+)'/g)].map(
  (match) => match[1],
);
const versions = summary.evals ?? [];
const threshold = typeof summary.evalThreshold === 'number' ? summary.evalThreshold : 0.9;
const shipping = versions.find((version) => /shipping/i.test(version.label ?? '')) ?? versions[0];
const belowThreshold = versions.filter((version) => (version.passRate ?? 0) < threshold);
const evalTotals = [...new Set(versions.map((version) => version.total))];
const probes = summary.probes ?? {};

// Case-study facts come from what the answers describe, not from the report: the annualizer
// with DEFECT-01 still in it, the two tenants' deadlines behind the isolation bug, the pages
// themselves, and the widths the site's own accessibility check scans.
const biweeklyAnnualized = annualizeIncome({ amount: 1, frequency: 'biweekly' });
const weeklyAnnualized = annualizeIncome({ amount: 1, frequency: 'weekly' });
const biweeklyCorrect = weeklyAnnualized / 2;
const deadlineA = TENANTS['agency-a']?.deadlineDays ?? null;
const deadlineB = TENANTS['agency-b']?.deadlineDays ?? null;
const caseStudyCount = caseStudyPages.length || null;
const viewportWidths = [...siteCheckSource.matchAll(/width:\s*(\d+)/g)].map((match) =>
  Number(match[1]),
);

if (!Number.isFinite(biweeklyAnnualized) || !Number.isFinite(biweeklyCorrect)) {
  problems.push(
    'product/server/lib/policy.mjs: could not derive the weekly and biweekly period counts, so "24 periods instead of 26" cannot be checked.',
  );
}
if (typeof deadlineA !== 'number' || typeof deadlineB !== 'number') {
  problems.push(
    'product/server/lib/store.mjs: agency-a and agency-b deadlineDays are not both numbers, so the tenant deadlines cannot be checked.',
  );
}
if (viewportWidths.length < 2) {
  problems.push(
    'scripts/check-site.mjs: could not read two VIEWPORTS widths, so "1280 and 360 pixels" cannot be checked.',
  );
}
if (caseStudyCount === null) {
  problems.push('site/case-studies: no pages found, so "four case studies" cannot be checked.');
}

if (projectNames.length === 0) {
  problems.push(
    'playwright.config.ts: could not read the browser projects, so "three browsers" and the journey count cannot be checked.',
  );
}
if (evalTotals.length > 1) {
  problems.push(
    `summary.evals: prompt versions report different case totals (${evalTotals.join(', ')}), so the knowledge base cannot state one number.`,
  );
}

const baselineChecks = baselineSuites.reduce(
  (total, suite) => total + (suite.present === false ? 0 : suite.passed ?? 0),
  0,
);
const browserCount = projectNames.length || null;
const browserJourneys = e2e?.present && browserCount ? e2e.passed * browserCount : null;
const failingProbes = probes.present ? probes.failed : null;
const goldenCases = evalTotals.length === 1 ? evalTotals[0] : null;

// Each claim is one sentence of the knowledge base and the evidence that has to back it.
// The patterns capture every number in the sentence, so a stale second copy is caught too.
const claims = [
  {
    label: 'baseline checks',
    pattern: /([\w]+) baseline checks/gi,
    expected: [baselineChecks],
    evidence: 'sum of the passing baseline suites in summary.suites',
    entries: ['pitch'],
  },
  {
    label: 'browser journeys',
    pattern: /([\w]+) browser journeys across ([\w]+) browsers/gi,
    expected: [browserJourneys, browserCount],
    evidence: 'Chromium passes in summary.suites × browser projects in playwright.config.ts',
    entries: ['pitch'],
  },
  {
    label: 'defect probes',
    pattern: /([\w]+) defect probes/gi,
    expected: [failingProbes],
    evidence: 'summary.probes.failed — the probes that fail by design',
    entries: ['pitch'],
  },
  {
    label: 'open high or critical risks',
    pattern: /([\w]+) (?:open )?high or critical risks/gi,
    expected: [summary.openBlockingRisks],
    evidence: 'summary.openBlockingRisks, from quality/risk-register.json',
    entries: ['pitch', 'green-limits', 'pushback'],
  },
  {
    label: 'prompt versions',
    pattern: /([\w]+) prompt versions/gi,
    expected: [versions.length || null],
    evidence: 'the number of versions in summary.evals',
    entries: ['ai-testing'],
  },
  {
    label: 'prompt versions below threshold',
    pattern: /([\w]+) prompt version(?:s)? (?:is|are) below/gi,
    expected: [versions.length ? belowThreshold.length : null],
    evidence: `versions in summary.evals under the ${Math.round(threshold * 100)}% threshold`,
    entries: ['pushback'],
  },
  {
    label: 'golden cases',
    pattern: /([\w]+) golden cases/gi,
    expected: [goldenCases],
    evidence: 'summary.evals[].total',
    entries: ['ai-testing'],
  },
  {
    label: 'shipping prompt score',
    pattern: /shipping version scores ([\w]+) of ([\w]+)/gi,
    expected: shipping ? [shipping.passed, shipping.total] : [null, null],
    evidence: 'the shipping entry in summary.evals',
    entries: ['ai-testing'],
  },
  {
    label: 'biweekly pay periods',
    pattern: /over ([\w]+) periods instead of ([\w]+)/gi,
    expected: [biweeklyAnnualized, biweeklyCorrect],
    evidence:
      'annualizeIncome() in product/server/lib/policy.mjs: a $1 biweekly pay annualizes to the defective factor, and weekly pay at 52 means 26 correct periods',
    entries: ['case-income-annualization'],
  },
  {
    label: 'tenant deadlines',
    pattern: /its ([\w]+)-day deadline with agency A's ([\w]+)-day one/gi,
    expected: [deadlineB, deadlineA],
    evidence: 'deadlineDays in product/server/lib/store.mjs (agency-b then agency-a)',
    entries: ['case-tenant-isolation'],
  },
  {
    label: 'case-study pages',
    pattern: /([\w]+) case studies/gi,
    expected: [caseStudyCount],
    evidence: 'the pages in site/case-studies/',
    entries: ['role'],
  },
  {
    label: 'accessibility viewports',
    pattern: /at ([\w]+) and ([\w]+) pixels/gi,
    expected: viewportWidths.slice(0, 2).length === 2 ? viewportWidths.slice(0, 2) : [null, null],
    evidence: 'the VIEWPORTS widths in scripts/check-site.mjs',
    entries: ['a11y'],
  },
];

for (const claim of claims) {
  if (claim.expected.some((value) => value === null || value === undefined)) {
    problems.push(
      `${claim.label}: the generated evidence does not contain this figure (${claim.evidence}).`,
    );
    continue;
  }

  const hits = [];
  for (const entry of knowledge) {
    const text = `${entry.title ?? ''} ${entry.answer ?? ''}`;
    for (const match of text.matchAll(claim.pattern)) {
      hits.push({ entry: entry.id, values: match.slice(1).map(numberOf) });
    }
  }

  if (hits.length === 0) {
    problems.push(
      `${claim.label}: knowledge.json no longer states this figure (expected ${claim.expected.join(
        '/',
      )}; ${claim.evidence}).`,
    );
    continue;
  }

  for (const hit of hits) {
    const same =
      hit.values.length === claim.expected.length &&
      hit.values.every((value, index) => value === claim.expected[index]);
    if (!same) {
      problems.push(
        `${claim.label}: "${hit.entry}" says ${hit.values.join('/')}, but the evidence says ${claim.expected.join(
          '/',
        )} (${claim.evidence}).`,
      );
    }
  }

  for (const entryId of claim.entries) {
    if (!hits.some((hit) => hit.entry === entryId)) {
      problems.push(
        `${claim.label}: expected this figure in the "${entryId}" answer, and it is not there.`,
      );
    }
  }
}

// Only a number can be the figure. A bare `[\w]+` capture would read "me Case studies" in
// the navigation or "the golden cases" in a sentence as a claim, and fail on a sentence that
// states no figure at all.
const NUMBER_TOKEN =
  '(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
const siteClaims = [
  {
    label: 'pay periods',
    pattern: new RegExp(`\\b(${NUMBER_TOKEN}) pay periods\\b`, 'gi'),
    expected: [biweeklyCorrect],
    evidence: 'weekly pay at 52 in product/server/lib/policy.mjs, so 26 biweekly periods',
  },
  {
    label: 'failing defect probes',
    pattern: new RegExp(`\\b(${NUMBER_TOKEN}) probes\\b`, 'gi'),
    expected: [failingProbes],
    evidence: 'summary.probes.failed — the probes that fail by design',
  },
  {
    label: 'open risks',
    pattern: new RegExp(`\\b(${NUMBER_TOKEN}) open risks\\b`, 'gi'),
    expected: [summary.openBlockingRisks],
    evidence: 'summary.openBlockingRisks, from quality/risk-register.json',
  },
  {
    label: 'case studies',
    pattern: new RegExp(`\\b(${NUMBER_TOKEN}) case studies\\b`, 'gi'),
    expected: [caseStudyCount],
    evidence: 'the pages in site/case-studies/',
  },
  {
    label: 'golden cases',
    pattern: new RegExp(`\\b(${NUMBER_TOKEN}) golden cases\\b`, 'gi'),
    expected: [goldenDatasetSize],
    evidence: 'the cases in tests/chatbot/golden.json',
  },
];

if (!siteText) {
  problems.push(
    `site copy: ${sitePath} was not found, so the numbers written into the page cannot be checked.`,
  );
} else {
  for (const claim of siteClaims) {
    if (claim.expected.some((value) => value === null || value === undefined)) {
      problems.push(
        `site copy (${claim.label}): the source does not contain this figure (${claim.evidence}).`,
      );
      continue;
    }

    const hits = [...siteText.matchAll(claim.pattern)];
    if (hits.length === 0) {
      problems.push(
        `site copy (${claim.label}): ${sitePath} no longer states this figure (expected ${claim.expected.join(
          '/',
        )}; ${claim.evidence}).`,
      );
      continue;
    }

    for (const hit of hits) {
      const values = hit.slice(1).map(numberOf);
      const same =
        values.length === claim.expected.length &&
        values.every((value, index) => value === claim.expected[index]);
      if (!same) {
        problems.push(
          `site copy (${claim.label}): "${hit[0].trim()}" reads ${values.join(
            '/',
          )}, but the evidence says ${claim.expected.join('/')} (${claim.evidence}).`,
        );
      }
    }
  }
}

// The report is what the site links to, so it has to state the same numbers as the summary.
const reportChecks = [
  {
    label: 'decision',
    pattern: /\*\*(READY|NOT READY|NOT VERIFIED)\*\*/g,
    expected: [summary.decision],
  },
  {
    label: 'open blocking risks',
    pattern: /- ([\w]+) open high or critical risk\(s\) remain/g,
    expected: [summary.openBlockingRisks],
  },
  {
    label: 'failing defect probes',
    pattern: /Known-defect probes: [^\n]*?\*\*([\w]+) failing\*\*/g,
    expected: [probes.present ? probes.failed : null],
  },
  {
    label: 'eval threshold',
    pattern: /threshold ([\w]+)%/g,
    expected: [Math.round(threshold * 100)],
  },
  {
    label: 'shipping prompt score',
    pattern: new RegExp(
      `\\(\\s*${escapeRegex(shipping?.label ?? 'shipping')}\\s*\\):\\s*([\\w]+)/([\\w]+)`,
      'g',
    ),
    expected: shipping ? [shipping.passed, shipping.total] : [null, null],
  },
  {
    label: 'hiring assistant cases',
    pattern: /Portfolio assistant [^\n]*?\*\*([\w]+)\/([\w]+)\*\* cases passed/g,
    expected: [summary.chatbot?.passed ?? null, summary.chatbot?.total ?? null],
  },
];

if (reportText) {
  for (const check of reportChecks) {
    if (check.expected.some((value) => value === null || value === undefined)) continue;
    const hits = [...reportText.matchAll(check.pattern)];
    if (hits.length === 0) {
      problems.push(`report: no line states the ${check.label}.`);
      continue;
    }
    for (const hit of hits) {
      const values = hit.slice(1).map((value) => numberOf(value) ?? value);
      const same =
        values.length === check.expected.length &&
        values.every((value, index) => String(value) === String(check.expected[index]));
      if (!same) {
        problems.push(
          `report: ${check.label} reads ${values.join('/')}, but the summary says ${check.expected.join(
            '/',
          )}.`,
        );
      }
    }
  }

  for (const suite of suites) {
    const row = new RegExp(
      `\\|\\s*${escapeRegex(suite.name)}\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|`,
    );
    const match = reportText.match(row);
    if (!match) {
      problems.push(`report: no table row for "${suite.name}".`);
    } else if (Number(match[1]) !== suite.passed || Number(match[2]) !== suite.failed) {
      problems.push(
        `report: the "${suite.name}" row reads ${match[1]}/${match[2]}, but the summary says ${suite.passed}/${suite.failed}.`,
      );
    }
  }
}

const derived = [
  ['baseline checks', `${baselineChecks} (${baselineSuites.length} suites)`],
  [
    'browser journeys',
    browserJourneys === null
      ? 'not run in this summary'
      : `${browserJourneys} (${e2e.passed} per browser × ${browserCount} browsers)`,
  ],
  [
    'defect probes',
    failingProbes === null ? 'not run in this summary' : `${failingProbes} failing`,
  ],
  ['open blocking risks', String(summary.openBlockingRisks)],
  [
    'prompt versions',
    `${versions.length} (${belowThreshold.length} below ${Math.round(threshold * 100)}%)`,
  ],
  ['golden cases', goldenCases === null ? 'inconsistent totals' : String(goldenCases)],
  ['shipping prompt', shipping ? `${shipping.passed}/${shipping.total}` : 'missing'],
  [
    'biweekly periods',
    `${biweeklyAnnualized} in policy.mjs, ${biweeklyCorrect} correct`,
  ],
  ['tenant deadlines', `A ${deadlineA} / B ${deadlineB} days`],
  ['case-study pages', String(caseStudyCount ?? 'missing')],
  ['axe viewports', viewportWidths.slice(0, 2).join(' / ') || 'missing'],
  [
    'page copy',
    siteText ? `${siteClaims.length} figures in ${sitePath}` : `${sitePath} not found`,
  ],
];

console.log('\nHiring assistant — knowledge base vs generated evidence and fixtures');
console.log(`  summary: ${summaryPath}`);
console.log(`  report:  ${reportText ? reportPath : 'not found (cross-check skipped)'}`);
for (const [label, value] of derived) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

if (problems.length > 0) {
  console.error(
    `\nFAIL — ${problems.length} figure problem(s) in the answers, the page copy or the evidence:`,
  );
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nThe assistant answers from published evidence and the code it describes, so the answer, the page copy, the report and the fixtures have to move together.',
  );
  process.exit(1);
}

console.log(
  '\nPASS — every figure in site/chat/knowledge.json matches the generated evidence and the fixtures it describes.',
);

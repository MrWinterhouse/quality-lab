#!/usr/bin/env node
/**
 * Injects the figures from artifacts/summary.json into the static site so the published
 * page can never disagree with the generated release report.
 *
 * Markup contract: a leaf element may carry data-figure="<key>". The script replaces the
 * element's text with that key's value and, where the key has a verdict, adds data-state
 * (pass | fail | missing) for styling. Unknown keys fail the build, because a number that
 * silently stops updating is the bug this script exists to prevent.
 *
 * Usage: node scripts/stamp-site.mjs [siteDir] [summaryPath]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [siteDir = '_site', summaryPath = path.join(siteDir, 'reports', 'summary.json')] =
  process.argv.slice(2);

let summary;
try {
  summary = JSON.parse(await readFile(summaryPath, 'utf8'));
} catch {
  console.warn(
    `[stamp-site] No summary at ${summaryPath}; leaving the site's last-known figures unchanged.`,
  );
  process.exit(0);
}

// The site's own accessibility/HTML check result, produced by scripts/check-site.mjs.
let siteReport = null;
try {
  siteReport = JSON.parse(
    await readFile(path.join(siteDir, 'reports', 'site-a11y.json'), 'utf8'),
  );
} catch {
  /* absent: the site.* keys will report as missing, which fails the build if used. */
}

// The eval gate threshold lives in artifacts/evals.json; fall back to the report's default.
let evalThreshold = 0.9;
try {
  const evals = JSON.parse(
    await readFile(path.join(path.dirname(summaryPath), 'evals.json'), 'utf8'),
  );
  if (typeof evals.threshold === 'number') evalThreshold = evals.threshold;
} catch {
  /* default threshold */
}

const E2E_NAME = 'End-to-end (Chromium)';
const suites = new Map((summary.suites ?? []).map((suite) => [suite.name, suite]));
const evalsByLabel = new Map((summary.evals ?? []).map((version) => [version.label, version]));
const baselineSuites = (summary.suites ?? []).filter((suite) => suite.name !== E2E_NAME);
const e2e = suites.get(E2E_NAME);

const escapeValue = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function suiteFigure(name) {
  const suite = suites.get(name);
  if (!suite) return null;
  if (!suite.present) return { value: 'not run', state: 'missing' };
  if (suite.failed > 0) return { value: `${suite.failed} fail`, state: 'fail' };
  return { value: `${suite.passed} pass`, state: 'pass' };
}

function evalFigure(label, suffix) {
  const version = evalsByLabel.get(label);
  if (!version) return null;
  const passRate = version.passRate ?? 0;
  const state = passRate >= evalThreshold ? 'pass' : 'fail';
  if (suffix === '.rate') {
    return { value: `${Math.round(passRate * 100)}%`, state };
  }
  return { value: `${version.passed ?? 0} / ${version.total ?? 0}`, state };
}

const figures = {
  decision: () => ({ value: summary.decision ?? 'UNKNOWN' }),
  date: () => ({ value: String(summary.generatedAt ?? '').slice(0, 10) || 'unknown' }),
  'risk.open': () => ({ value: String(summary.openBlockingRisks ?? 0) }),
  'baseline.total': () => ({
    value: String(baselineSuites.reduce((total, suite) => total + (suite.passed ?? 0), 0)),
  }),
  'e2e.passed': () => ({
    value: String(e2e?.passed ?? 0),
    state: e2e && e2e.failed === 0 ? 'pass' : 'fail',
  }),
  'eval.cases': () => ({ value: String(summary.evals?.[0]?.total ?? 0) }),
  'probes.failed': () => ({
    value: String(summary.probes?.failed ?? 0),
    state: summary.probes?.failed ? 'fail' : 'pass',
  }),
  'load.requests': () => ({ value: String(summary.load?.requests ?? 0) }),
  'site.pages': () => (siteReport ? { value: String(siteReport.pages ?? 0) } : null),
  'site.axe': () =>
    siteReport
      ? {
          value: String(siteReport.axeViolations ?? 0),
          state: siteReport.axeViolations ? 'fail' : 'pass',
        }
      : null,
  'site.html': () =>
    siteReport
      ? {
          value: String(siteReport.htmlErrors ?? 0),
          state: siteReport.htmlErrors ? 'fail' : 'pass',
        }
      : null,
  'load.summary': () => {
    if (!summary.load) return { value: 'not run', state: 'missing' };
    const errorRate = Number(((summary.load.errorRate ?? 0) * 100).toFixed(2));
    return {
      value: `p95 ${Math.round(summary.load.p95 ?? 0)} ms, ${errorRate} err`,
      state: summary.load.passed ? 'pass' : 'fail',
    };
  },
};

function resolve(key) {
  if (figures[key]) return figures[key]();

  if (key.startsWith('suite.')) return suiteFigure(key.slice('suite.'.length));

  const evalMatch = key.match(/^eval\.([a-z0-9-]+)(\.rate)?$/i);
  if (evalMatch) return evalFigure(evalMatch[1], evalMatch[2] ?? '');

  return null;
}

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) files.push(full);
  }
  return files;
}

const ELEMENT = /<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?\sdata-figure="([^"]+)"[^<>]*?)>([^<]*)<\/\1>/g;

let stamped = 0;
const missing = new Set();

for (const file of await htmlFiles(siteDir)) {
  const html = await readFile(file, 'utf8');
  let touched = false;

  const next = html.replace(ELEMENT, (match, tag, attrs, key) => {
    const figure = resolve(key);
    if (!figure) {
      missing.add(key);
      return match;
    }
    touched = true;
    stamped += 1;
    const clean = attrs.replace(/\sdata-state="[^"]*"/g, '');
    const state = figure.state ? ` data-state="${figure.state}"` : '';
    return `<${tag}${clean}${state}>${escapeValue(figure.value)}</${tag}>`;
  });

  if (touched) await writeFile(file, next, 'utf8');
}

if (missing.size > 0) {
  console.error(`[stamp-site] No value for: ${[...missing].join(', ')}`);
  console.error('[stamp-site] A stale figure is worse than a failed build. Fix the key or the summary.');
  process.exit(1);
}

console.log(`[stamp-site] Stamped ${stamped} figure(s) from ${summaryPath}.`);

#!/usr/bin/env node
/**
 * Checks the portfolio site itself: HTML structure plus WCAG 2.1 A/AA via axe-core in
 * Chromium. Writes artifacts/site-a11y.{json,md} and exits non-zero on any finding, so the
 * published page can state the real number instead of a claim.
 *
 * Usage: node scripts/check-site.mjs [siteDir] [--strict] [--links-only]
 *
 *   --strict      report links must resolve; run it against the assembled _site
 *   --links-only  skip axe and the report artifacts, so no browser is needed
 *
 * In GitHub Actions every finding is also emitted as a ::error annotation, so a red run names
 * the page, line and problem on the run page instead of only in the raw step log.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const linksOnly = args.includes('--links-only');
const siteDir = args.find((arg) => !arg.startsWith('--')) ?? 'site';
const OUT_DIR = 'artifacts';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

// GitHub turns a `::error` workflow command into a step annotation, which is why a failing
// run can point at the file and line instead of leaving the reason in the log. Locally the
// same finding is written to stderr as plain text.
const ANNOTATIONS = process.env.GITHUB_ACTIONS === 'true';
const escapeData = (text) =>
  String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

function annotate(message, { file, line } = {}) {
  if (!ANNOTATIONS) {
    // The message already names the page, so the file only matters to the annotation.
    console.error(`  ${message}`);
    return;
  }
  const properties = ['title=check-site'];
  if (file) properties.push(`file=${escapeProperty(file)}`);
  if (line) properties.push(`line=${line}`);
  console.log(`::error ${properties.join(',')}::${escapeData(message)}`);
}

// Annotations are kept only for files in the checked-out tree, so a finding in the assembled
// _site build is filed against the source page it was copied from; the assembled path and line
// stay in the message. Line numbers are only trusted when the annotation points at the file
// that was actually read, since stamp-site rewrites the assembled copies.
const ASSEMBLED_ALIASES = new Map([['_site', 'site']]);
function annotationPath(file) {
  const segments = file.split('/');
  const source = ASSEMBLED_ALIASES.get(segments[0]);
  return source ? [source, ...segments.slice(1)].join('/') : file;
}

function reportFinding(result, message, line) {
  const file = annotationPath(result.file);
  const located = file === result.file;
  const where = located ? result.page : result.file;
  const prefix = line && !located ? `line ${line}: ` : '';
  annotate(`${where}: ${prefix}${message}`, { file, line: located ? line : undefined });
}

// A crash (ENOENT on an artifact that never downloaded, a browser that will not launch) is a
// finding too: without this the step only says "exited with code 1". A rejected top-level
// await arrives as an uncaughtException, not as an unhandledRejection, so both are covered.
let crashed = false;
function reportCrash(error) {
  if (crashed) return;
  crashed = true;
  annotate(`check-site crashed before reporting findings: ${error?.stack ?? error}`);
  process.exitCode = 1;
}
process.on('unhandledRejection', reportCrash);
process.on('uncaughtException', reportCrash);

function checkMarkup(html) {
  const problems = [];
  if (!/<!doctype\s+html/i.test(html)) problems.push('missing <!doctype html>');
  if (!/<html[^>]*\slang="[^"]+"/i.test(html)) problems.push('<html> has no lang attribute');

  const title = html.match(/<title>([^<]*)<\/title>/i);
  if (!title || title[1].trim() === '') problems.push('missing or empty <title>');
  if (!/<meta[^>]+name="viewport"/i.test(html)) problems.push('missing viewport meta tag');

  const body = stripComments(html);

  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((candidate) => candidate === id).length > 1) {
      problems.push(`duplicate id "${id}"`);
    }
  }

  const headings = [...body.matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));
  const h1Count = headings.filter((level) => level === 1).length;
  if (h1Count !== 1) problems.push(`expected exactly one <h1>, found ${h1Count}`);
  let previous = 0;
  for (const level of headings) {
    if (previous && level > previous + 1) {
      problems.push(`heading level jumps from h${previous} to h${level}`);
    }
    previous = level;
  }

  for (const image of body.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\salt="[^"]*"/i.test(image[0])) {
      problems.push(`<img> without alt: ${image[0].slice(0, 80)}`);
    }
  }

  for (const link of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = link[1];
    const inner = link[2].replace(/<[^>]+>/g, '').trim();
    const named =
      inner.length > 0 ||
      /aria-label="[^"]+"/i.test(attrs) ||
      /<img[^>]+alt="[^"]+"/i.test(link[2]);
    if (!named) problems.push(`link without an accessible name: <a${attrs.slice(0, 60)}>`);
  }

  for (const handler of body.matchAll(/\son[a-z]+="[^"]*"/gi)) {
    problems.push(`inline event handler ${handler[0].slice(0, 30)}`);
  }

  const stack = [];
  for (const tag of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, rawName, , selfClose] = tag;
    const name = rawName.toLowerCase();
    if (closing) {
      const open = stack.pop();
      if (!open) problems.push(`unexpected closing </${name}>`);
      else if (open !== name) problems.push(`closing </${name}> does not match <${open}>`);
    } else if (!selfClose && !VOID_ELEMENTS.has(name)) {
      stack.push(name);
    }
  }
  for (const open of stack.reverse()) problems.push(`unclosed <${open}>`);

  return problems;
}

// Report links are assembled by the publish job from CI artifacts, so they do not exist in
// a plain checkout. There they are counted and disclosed; with --strict, which the publish
// job runs over the built site, a missing target is a failure.
const REPORT_PREFIX = 'reports/';

const lineOf = (html, index) => html.slice(0, index).split('\n').length;

function checkLinks(html, file, strict) {
  const problems = [];
  let deferred = 0;

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const ref = match[1];

    if (ref.startsWith('#')) {
      if (ref.length > 1 && !html.includes(`id="${ref.slice(1)}"`)) {
        problems.push({
          message: `anchor without a target: "${ref}"`,
          line: lineOf(html, match.index),
        });
      }
      continue;
    }

    // http:, https:, mailto:, data:, tel: — anything with a scheme is out of scope.
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) continue;

    const [relative] = ref.split(/[?#]/);
    const target = path.resolve(path.dirname(file), relative);
    if (existsSync(target) || existsSync(path.join(target, 'index.html'))) continue;

    if (!strict && ref.startsWith(REPORT_PREFIX)) {
      deferred += 1;
      continue;
    }

    problems.push({
      message: `broken internal link "${ref}"`,
      line: lineOf(html, match.index),
    });
  }

  return { problems, deferred };
}

// Generated report output (the Playwright HTML report, the rendered markdown) is someone
// else's markup. It is not held to this site's rules, though links into it are resolved.
const GENERATED_DIRS = new Set(['reports']);

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (GENERATED_DIRS.has(entry.name)) continue;
      files.push(...(await htmlFiles(full)));
    } else if (entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files.sort();
}

const pages = await htmlFiles(siteDir);

// Loaded here rather than at the top of the file: the publish job runs the strict link check
// from a bare checkout with no node_modules, and only the axe pass needs these packages.
let browser = null;
let AxeBuilder = null;
if (!linksOnly) {
  const [{ chromium }, axe] = await Promise.all([
    import('@playwright/test'),
    import('@axe-core/playwright'),
  ]);
  AxeBuilder = axe.default;
  browser = await chromium.launch();
}

const context = browser
  ? await browser.newContext({ viewport: { width: 1280, height: 900 } })
  : null;
const results = [];

for (const file of pages) {
  const source = await readFile(file, 'utf8');
  const links = checkLinks(source, file, strict);
  const markupProblems = checkMarkup(source);
  const htmlProblems = [...markupProblems, ...links.problems.map((problem) => problem.message)];

  let violations = [];
  if (context) {
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.resolve(file)).href, { waitUntil: 'load' });
    const scan = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    violations = scan.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    }));
    await page.close();
  }

  results.push({
    page: path.relative(siteDir, file).split(path.sep).join('/'),
    file: file.split(path.sep).join('/'),
    url: pathToFileURL(path.resolve(file)).href,
    htmlProblems,
    markupProblems,
    linkProblems: links.problems,
    deferredLinks: links.deferred,
    violations,
  });
}

await browser?.close();

const axeViolations = results.reduce((total, result) => total + result.violations.length, 0);
const axeNodes = results.reduce(
  (total, result) => total + result.violations.reduce((sum, v) => sum + v.nodes.length, 0),
  0,
);
const htmlErrors = results.reduce((total, result) => total + result.htmlProblems.length, 0);
const deferredLinks = results.reduce((total, result) => total + result.deferredLinks, 0);
const passed = axeViolations === 0 && htmlErrors === 0;
const checkedAt = new Date().toISOString();

const summary = {
  checkedAt,
  pages: results.length,
  axeViolations,
  axeNodes,
  htmlErrors,
  deferredLinks,
  passed,
  standard: 'WCAG 2.1 A/AA (axe-core)',
  viewport: '1280x900',
  results,
};

const details = results
  .filter((result) => result.violations.length > 0 || result.htmlProblems.length > 0)
  .map((result) => {
    const lines = [`### ${result.page}`, ''];
    for (const violation of result.violations) {
      lines.push(`- **${violation.id}** (${violation.impact}) — ${violation.help}`);
      for (const node of violation.nodes) lines.push(`  - \`${node}\``);
    }
    for (const problem of result.htmlProblems) lines.push(`- **HTML** — ${problem}`);
    return lines.join('\n');
  })
  .join('\n\n');

const report = `# Site accessibility and HTML checks

_Generated ${checkedAt} by \`npm run check:site\`._

## Result

**${passed ? 'PASS' : 'FAIL'}** — ${results.length} pages, **${axeViolations}** axe violation(s)
across ${axeNodes} node(s), **${htmlErrors}** HTML structure problem(s).

| Page | axe violations | HTML problems |
| --- | ---: | ---: |
${results
  .map(
    (result) =>
      `| \`${result.page}\` | ${result.violations.length} | ${result.htmlProblems.length} |`,
  )
  .join('\n')}

${passed ? '' : `## Findings\n\n${details}\n`}
## What this checks

- axe-core WCAG 2.1 A/AA rules in Chromium at 1280×900, on every page in \`site/\`.
- Exactly one \`<h1>\`, no skipped heading levels, unique ids, \`lang\`, \`<title>\`, viewport meta.
- Accessible names for links, \`alt\` on images, no inline event handlers.
- Balanced tags, and every internal link and asset inside site/ resolving, in-page
  fragments included.
- ${deferredLinks} link(s) point into reports/. Those files are assembled by the publish
  job, which re-runs this check over the built site with --strict, so a dead report link
  fails the deploy instead of being counted.

## What this does not check

- The generated report pages (Playwright HTML, rendered markdown): third-party output,
  not this site's markup. Only links into them are resolved.
- A real screen-reader or keyboard journey, focus order, or focus return after a dialog.
- Contrast under forced-colors / high-contrast modes, zoom beyond 200%, or reflow at 320px.
- Content quality: an accessible page can still be wrong or unclear.
- The product in \`product/\` — that is covered by the axe probe in \`tests/probes/e2e/\`.
`;

if (!linksOnly) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'site-a11y.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(OUT_DIR, 'site-a11y.md'), report);
}

const scope = linksOnly
  ? 'links and markup only'
  : `${axeViolations} axe violation(s) in ${axeNodes} node(s)`;
console.log(
  `[check-site] ${passed ? 'PASS' : 'FAIL'} — ${results.length} pages, ${scope}, ` +
    `${htmlErrors} HTML problem(s)${strict ? ' [strict]' : ''}`,
);

if (!passed) {
  for (const result of results) {
    for (const violation of result.violations) {
      const nodes = violation.nodes.length > 0 ? ` [${violation.nodes.join(', ')}]` : '';
      reportFinding(
        result,
        `${violation.id} (${violation.impact}) ${violation.help}${nodes}`,
      );
    }
    for (const problem of result.markupProblems) reportFinding(result, problem);
    for (const problem of result.linkProblems) {
      reportFinding(result, problem.message, problem.line);
    }
  }
  process.exitCode = 1;
}

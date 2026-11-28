#!/usr/bin/env node
/**
 * Builds the site the publish job builds — site/ plus artifacts/, with the markdown reports
 * rendered to HTML — into _site, then serves it on 127.0.0.1.
 *
 * site/ has no reports/ directory: those files are assembled at deploy time from CI
 * artifacts, so locally every evidence link 404s until a deploy has run. This produces the
 * same tree from whatever artifacts/ already holds, which is enough to read the reports and
 * check their links without waiting for a push.
 *
 * It is a preview, not a deploy: nothing leaves the machine.
 *
 * Usage: node scripts/preview-site.mjs [--port 4322] [--build-only]
 */
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const requestedPort = Number(portFlag === -1 ? 4322 : args[portFlag + 1]) || 4322;
const buildOnly = args.includes('--build-only');

const OUT = '_site';
const ARTIFACTS = 'artifacts';

// The same three pages the workflow renders, with the same titles and source commands, so a
// local report is the page that would have been published.
const REPORTS = [
  ['quality-report.md', 'quality-report.html', 'Release readiness report', 'npm run report'],
  ['site-a11y.md', 'site-a11y.html', 'Site accessibility and HTML checks', 'npm run check:site'],
  [
    'chatbot-eval.md',
    'chatbot-eval.html',
    'Hiring assistant — golden-dataset evaluation',
    'npm run test:chatbot',
  ],
];

await rm(OUT, { recursive: true, force: true });
await cp('site', OUT, { recursive: true });
await mkdir(path.join(OUT, 'reports'), { recursive: true });

// Evidence only: the reports, the JSON the page is stamped from and the JUnit XML. Local
// artifacts/ also collects logs, screenshots and one-off HTML snapshots that were never part
// of the published site, and copying those would put pages under the link check that CI never
// builds.
const EVIDENCE = new Set(['.md', '.json', '.xml']);

let copied = 0;
for (const entry of await readdir(ARTIFACTS, { withFileTypes: true })) {
  const from = path.join(ARTIFACTS, entry.name);
  if (entry.isFile() && EVIDENCE.has(path.extname(entry.name))) {
    await cp(from, path.join(OUT, 'reports', entry.name));
    copied += 1;
  } else if (entry.name === 'playwright-html') {
    await cp(from, path.join(OUT, 'reports', 'playwright'), { recursive: true });
    copied += 1;
  }
}

for (const [input, output, title, source] of REPORTS) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/render-report-html.mjs',
      path.join(ARTIFACTS, input),
      path.join(OUT, 'reports', output),
      title,
      source,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The figures the published page states come from the same summary the deploy stamps with.
spawnSync(
  process.execPath,
  ['scripts/stamp-site.mjs', OUT, path.join(OUT, 'reports', 'summary.json')],
  { stdio: 'inherit' },
);

console.log(`[preview] assembled ${OUT}/ from site/ and ${copied} artifact(s)`);
if (buildOnly) process.exit(0);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // Markdown lands as text instead of a download, the way GitHub Pages serves it.
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
};

const root = path.resolve(OUT);

async function handler(request, response) {
  const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
  const target = path.join(root, decodeURIComponent(pathname));

  // A link that climbs out of the assembled site is not served, exactly as on Pages.
  if (target !== root && !target.startsWith(root + path.sep)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('forbidden\n');
    return;
  }

  const file = pathname.endsWith('/') ? path.join(target, 'index.html') : target;
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch (error) {
    if (error.code === 'EISDIR') {
      response.writeHead(301, { Location: `${pathname}/` });
      response.end();
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`not found: ${pathname}\n`);
  }
}

function listen(port, attemptsLeft) {
  const server = http.createServer(handler);
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn(`[preview] port ${port} is busy, trying ${port + 1}`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(`[preview] ${error.message}`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[preview] http://127.0.0.1:${port}/ — reports at /reports/quality-report.html`);
  });
}

listen(requestedPort, 10);

#!/usr/bin/env node
/**
 * Wraps the generated markdown release report in a readable HTML page for GitHub Pages.
 * Browsers download .md files instead of rendering them, so the published site links to
 * this page and keeps the raw markdown beside it.
 *
 * Usage: node scripts/render-report-html.mjs [input.md] [output.html] [title] [source command]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [
  input = 'artifacts/quality-report.md',
  output = '_site/reports/quality-report.html',
  title = 'Release readiness report',
  source = 'npm run report',
] = process.argv.slice(2);

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (text) => text.replace(/[&<>"]/g, (char) => ENTITIES[char]);

let markdown;
try {
  markdown = await readFile(input, 'utf8');
} catch {
  markdown = `No quality report was produced by this run.\n\nExpected: ${input}`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="../styles.css">
<style>
  .report-shell { max-width: 62rem; margin: 0 auto; padding: 2.25rem 1.5rem 4rem; }
  .report-shell h1 { font-size: clamp(1.7rem, 3vw, 2.3rem); }
  .report-body { background: #fffdf9; border: 1px solid var(--line); padding: 1.25rem; overflow-x: auto; }
  .report-body pre { background: none; color: var(--ink); padding: 0; margin: 0; font-size: 0.84rem; line-height: 1.6; }
</style>
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="../"><span>◇</span> Quality engineering portfolio</a>
  </div>
</header>
<main class="report-shell">
  <p class="kicker">Generated artifact · markdown source, rendered verbatim</p>
  <h1>${escapeHtml(title)}</h1>
  <p>
    Written by <code>${escapeHtml(source)}</code> during CI.
    <a href="quality-report.md">Raw markdown</a> ·
    <a href="playwright/">Browser report</a> ·
    <a href="../">Back to the portfolio</a>
  </p>
  <div class="report-body"><pre>${escapeHtml(markdown)}</pre></div>
</main>
</body>
</html>
`;

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(`Rendered ${input} -> ${output}`);

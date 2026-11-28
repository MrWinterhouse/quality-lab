#!/usr/bin/env node
/**
 * Wraps the generated markdown release report in a readable HTML page for GitHub Pages.
 * Browsers download .md files instead of rendering them, so the published site links to
 * this page and keeps the raw markdown beside it.
 *
 * The markdown is rendered to real HTML (headings, tables, lists, code) instead of being
 * dropped into a <pre>: a release report whose tables are pipe characters is not readable,
 * and the point of publishing it is that a non-engineer can read the verdict.
 *
 * The renderer covers what the reports actually emit: ATX headings, paragraphs, bullet and
 * numbered lists, pipe tables with alignment, fenced code blocks, blockquotes, rules, and
 * inline code / bold / italic / links. It deliberately has no dependency: the report path
 * must not be able to fail because a markdown package resolved differently in CI.
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
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (char) => ENTITIES[char]);

const FENCE = /^\s*(```|~~~)\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/** Splits a table row on pipes that are not inside a code span. */
function splitRow(line) {
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cell = '';
  let inCode = false;
  for (const char of text) {
    if (char === '`') inCode = !inCode;
    if (char === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** `:---` left, `---:` right, `:---:` centre, `---` default. */
function alignments(separator) {
  return splitRow(separator).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'num';
    if (left) return 'left';
    return '';
  });
}

const isTableSeparator = (line) =>
  typeof line === 'string' && line.trimStart().startsWith('|') && /^[|\s:-]+$/.test(line) && line.includes('-');

// Inline formatting runs after escaping, so the text inside the tags is already safe.
function emphasis(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
}

// Code spans are swapped for placeholders first so emphasis still spans a paragraph that
// contains code, as in "_Generated … by `npm run report`._": emphasis around a code span is
// common, and splitting the paragraph at every code span would leave both underscores literal.
function renderInline(text) {
  const codes = [];
  const placeholder = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  return emphasis(placeholder).replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)]);
}

/** Pulls the report's own title out so the page has one h1, not two. */
function takeLeadingHeading(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim());
  const match = first === -1 ? null : lines[first].match(HEADING);
  if (!match || match[1].length !== 1) return { heading: null, lines };
  return { heading: match[2].trim(), lines: lines.slice(first + 1) };
}

function renderMarkdown(lines) {
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].match(FENCE)) code.push(lines[index++]);
      index += 1; // closing fence, or past the end of an unterminated block
      const language = fence[2] ? ` class="language-${fence[2]}"` : '';
      html.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      // A stray later h1 becomes an h2: the page already has one h1.
      const level = Math.min(6, Math.max(2, heading[1].length));
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      html.push('<hr>');
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith('|') && isTableSeparator(lines[index + 1])) {
      const headers = splitRow(line);
      const aligns = alignments(lines[index + 1]);
      const cell = (tag, text, column) => {
        const align = aligns[column] ? ` class="${aligns[column]}"` : '';
        return `<${tag}${align}>${renderInline(text)}</${tag}>`;
      };
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trimStart().startsWith('|')) {
        const cells = splitRow(lines[index]);
        rows.push(`<tr>${headers.map((_, column) => cell('td', cells[column] ?? '', column)).join('')}</tr>`);
        index += 1;
      }
      html.push(
        [
          '<div class="table-wrap">',
          '<table>',
          `<thead><tr>${headers.map((text, column) => cell('th', text, column)).join('')}</tr></thead>`,
          `<tbody>${rows.join('')}</tbody>`,
          '</table>',
          '</div>',
        ].join(''),
      );
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const start = ordered ? Number.parseInt(item[2], 10) : 1;
      const items = [];
      while (index < lines.length) {
        const current = lines[index].match(LIST_ITEM);
        if (current) {
          items.push(current[3].trim());
          index += 1;
          continue;
        }
        // A wrapped line indented under the item belongs to it; anything else ends the list.
        if (lines[index].trim() && /^\s{2,}/.test(lines[index]) && !FENCE.test(lines[index])) {
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      const listItems = items.map((text) => `<li>${renderInline(text)}</li>`).join('');
      const startAttribute = ordered && start !== 1 ? ` start="${start}"` : '';
      html.push(ordered ? `<ol${startAttribute}>${listItems}</ol>` : `<ul>${listItems}</ul>`);
      continue;
    }

    if (QUOTE.test(line)) {
      const quote = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quote.push(lines[index].match(QUOTE)[1]);
        index += 1;
      }
      html.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      const next = lines[index];
      if (FENCE.test(next) || HEADING.test(next) || RULE.test(next) || LIST_ITEM.test(next) || QUOTE.test(next)) break;
      if (next.trimStart().startsWith('|') && isTableSeparator(lines[index + 1])) break;
      paragraph.push(next.trim());
      index += 1;
    }
    // A block start that stopped the paragraph is handled by the loop above; an empty
    // paragraph can only happen if the very first line is such a block, which cannot be.
    if (paragraph.length) html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    else index += 1;
  }

  return html.join('\n');
}

let markdown;
try {
  markdown = await readFile(input, 'utf8');
} catch {
  markdown = `No quality report was produced by this run.\n\nExpected: ${input}`;
}

const { heading, lines } = takeLeadingHeading(markdown);
const pageTitle = heading ?? title;
const body = renderMarkdown(lines);

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
  .report-body { background: var(--paper-2); border: 3px solid var(--line); padding: 1.25rem 1.35rem 1.6rem; }
  .report-body > :first-child { margin-top: 0; }
  .report-body > :last-child { margin-bottom: 0; }
  .report-body p, .report-body li { line-height: 1.7; max-width: 62ch; }
  .report-body h2 { font-size: 1.25rem; margin: 2rem 0 0.7rem; }
  .report-body h3 { font-size: 1.05rem; margin: 1.6rem 0 0.5rem; }
  .report-body ul, .report-body ol { padding-left: 1.3rem; margin: 0.85rem 0; }
  .report-body li { margin: 0.35rem 0; }
  .report-body li > strong { color: var(--ink); }
  .report-body code { background: var(--paper-3); border: 1px solid var(--line); border-radius: 3px; padding: 0.08em 0.35em; font-size: 0.9em; }
  .report-body pre { background: var(--paper); border: 1px solid var(--line); padding: 0.9rem 1rem; margin: 1rem 0; overflow-x: auto; }
  .report-body pre code { background: none; border: 0; padding: 0; font-size: 0.86rem; line-height: 1.6; }
  .report-body .table-wrap { margin: 1rem 0; overflow-x: auto; }
  .report-body table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
  .report-body th, .report-body td { border: 1px solid var(--line); padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
  .report-body thead th { background: var(--paper-3); color: var(--ink); }
  .report-body tbody tr:nth-child(even) { background: rgba(255, 255, 255, 0.02); }
  .report-body th.num, .report-body td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .report-body th.center, .report-body td.center { text-align: center; }
  .report-body blockquote { border-left: 3px solid var(--rust); margin: 1rem 0; padding-left: 0.9rem; color: var(--ink-soft); }
  .report-body hr { border: 0; border-top: 1px solid var(--line); margin: 1.75rem 0; }
  .report-body a { color: var(--teal); }
</style>
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="../"><span>◇</span> Quality engineering portfolio</a>
  </div>
</header>
<main class="report-shell">
  <p class="kicker">Generated artifact · the report CI wrote for this run</p>
  <h1>${escapeHtml(pageTitle)}</h1>
  <p>
    Written by <code>${escapeHtml(source)}</code> during CI.
    <a href="quality-report.md">Raw markdown</a> ·
    <a href="playwright/">Browser report</a> ·
    <a href="../">Back to the portfolio</a>
  </p>
  <div class="report-body">
${body}
  </div>
</main>
</body>
</html>
`;

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(`Rendered ${input} -> ${output}`);

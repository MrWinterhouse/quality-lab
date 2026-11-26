#!/usr/bin/env node
/**
 * Loads the portfolio's hiring assistant in Chromium and exercises one real exchange.
 *
 * The golden dataset covers the engine; this covers the wiring the dataset cannot see —
 * the knowledge base loading over HTTP, controls staying disabled until it is ready, an
 * answer rendering with its source links and its golden-case panel, and a refusal being
 * reachable by typing.
 *
 * Usage: node scripts/check-chat-page.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve('site');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
  const file = path.join(root, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end(`not found: ${pathname}`);
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const problems = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
page.on('response', (response) => {
  if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
});

try {
  await page.goto(`${origin}/chat.html`, { waitUntil: 'load' });

  // Clicking a suggestion must wait for the controls, which are disabled until the
  // knowledge base has loaded; a dropped click is the bug this check exists for.
  await page.getByRole('button', { name: 'Why should we hire you?' }).click();
  const answer = page.locator('.chat-msg--assistant .chat-text').last();
  await answer.waitFor({ timeout: 10000 });
  const answerText = (await answer.textContent()) ?? '';
  if (!answerText.includes('release decision')) {
    problems.push(`the pitch did not render: ${answerText.slice(0, 120)}`);
  }
  const sources = page.locator('.chat-msg--assistant .chat-sources a');
  if ((await sources.count()) === 0) problems.push('the answer rendered without source links');

  // The page claims each answer shows how it is tested, so the panel has to be there, name
  // the case that covers the question, and actually open.
  const pitchPanel = page.locator('.chat-msg--assistant').last().locator('.chat-tests');
  if ((await pitchPanel.count()) === 0) {
    problems.push('the pitch rendered without its golden-case panel');
  } else {
    const panelText = (await pitchPanel.textContent()) ?? '';
    if (!panelText.includes('why-hire')) {
      problems.push(`the pitch panel does not name its case: ${panelText.slice(0, 120)}`);
    }
    await pitchPanel.locator('summary').click();
    if (!(await pitchPanel.evaluate((element) => element.open))) {
      problems.push('the golden-case panel did not expand when its summary was clicked');
    }
  }

  await page.getByLabel('Your question').fill('Where are you based?');
  await page.getByRole('button', { name: 'Ask' }).click();
  const refusal = page.locator('.chat-msg--assistant .chat-text').last();
  await refusal.waitFor({ timeout: 10000 });
  const refusalText = (await refusal.textContent()) ?? '';
  if (!refusalText.includes('not published here')) {
    problems.push(`the boundary case did not refuse: ${refusalText.slice(0, 120)}`);
  }
  const refusalPanel =
    (await page.locator('.chat-msg--assistant').last().locator('.chat-tests').textContent()) ?? '';
  if (!refusalPanel.includes('where-based')) {
    problems.push(`the boundary refusal did not show its case: ${refusalPanel.slice(0, 120)}`);
  }
} catch (error) {
  problems.push(`interaction failed: ${error.message.split('\n')[0]}`);
} finally {
  await browser.close();
  server.close();
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`  chat.html: ${problem}`);
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(`::error title=chat page::${String(problem).replace(/%/g, '%25')}`);
    }
  }
  process.exitCode = 1;
} else {
  console.log(
    '[check-chat-page] PASS — suggestion answered with sources and its golden-case panel, typed question refused.',
  );
}

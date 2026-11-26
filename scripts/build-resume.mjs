#!/usr/bin/env node
/**
 * Builds `site/resume.pdf` from `quality/resume.json`.
 *
 * The fixture is the single source of the resume facts: the experience section on the front
 * page and the assistant's answers are gated against it, so generating the PDF from it means
 * the document a recruiter downloads cannot describe a different career than the page. Print
 * through Chromium, so links stay clickable in the PDF.
 *
 * Usage: node scripts/build-resume.mjs [outputPath]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const resume = JSON.parse(await readFile('quality/resume.json', 'utf8'));
const output = process.argv[2] ?? resume.resumeFile;

const roleLine = (role) => `${role.startYear}–${role.endYear}`;
const contactLine = [
  `${resume.contact.city}, ${resume.contact.state}`,
  resume.contact.email,
  resume.contact.github.replace(/^https?:\/\//, ''),
].join(' · ');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>John Winterhouse — Quality Engineer (resume)</title>
<style>
  @page { margin: 0.55in 0.65in; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 9.6pt;
    line-height: 1.35;
    color: #171a1f;
  }
  h1 { font-size: 19pt; margin: 0; letter-spacing: -0.01em; }
  .role { font-size: 10.5pt; color: #7a3b1d; margin: 1pt 0 2pt; }
  .contact { font-size: 8.6pt; color: #41474f; margin: 0 0 10pt; }
  h2 {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #7a3b1d;
    margin: 11pt 0 4pt;
    padding-bottom: 2pt;
    border-bottom: 0.6pt solid #c9c3b6;
  }
  p { margin: 0 0 4pt; }
  .job { margin-bottom: 6pt; }
  .job-head { display: flex; justify-content: space-between; gap: 12pt; }
  .job-head strong { font-size: 10pt; }
  .job-head .when { font-size: 8.6pt; color: #4a5058; white-space: nowrap; }
  .job-place { font-size: 8.6pt; color: #5b6169; margin: 0 0 2pt; }
  ul { margin: 2pt 0 0; padding-left: 13pt; }
  li { margin: 0 0 1.5pt; }
  .skills { margin: 0; }
  .skills div { margin-bottom: 2pt; }
  .skills b { font-weight: 600; }
  a { color: inherit; text-decoration: none; border-bottom: 0.5pt solid #c9c3b6; }
  .note { font-size: 8.2pt; color: #5b6169; margin-top: 8pt; }
</style>
</head>
<body>
  <h1>John Winterhouse</h1>
  <p class="role">Quality Engineer · AI-assisted testing, automation architecture, release decisions</p>
  <p class="contact">${contactLine}</p>

  <h2>Summary</h2>
  <p>
    AI-driven quality engineer with ${resume.yearsExperience}+ years building automated testing
    across UI, API, integration and backend applications: Playwright and TypeScript, C# and
    Selenium, REST API testing, SQL validation and CI/CD. Uses Claude and ChatGPT to accelerate
    test development and maintenance, and keeps the release signal honest — the same evidence
    standard this portfolio demonstrates.
  </p>

  <h2>Experience</h2>
  ${resume.roles
    .map(
      (role) => `<div class="job">
    <div class="job-head">
      <strong>${role.employer} · ${role.title}</strong>
      <span class="when">${roleLine(role)}</span>
    </div>
    <p class="job-place">${role.location}</p>
    ${roleBullets(role)}
  </div>`,
    )
    .join('')}

  <h2>AI-assisted engineering</h2>
  <ul>
    <li>Custom Claude <code>/heal</code> skill: investigates failing tests, analyzes application code, implements and validates fixes, and opens pull requests.</li>
    <li>AI-drafted Playwright UI and API cases across ${resume.aiAssisted.automatedTests}+ automated tests, with failures triaged and repaired through the same loop.</li>
    <li>Quality dashboard for failures, flaky tests, Lighthouse performance and coverage, plus ${resume.aiAssisted.checklyChecks}+ Checkly synthetic checks with Slack alerts on critical workflows.</li>
    <li>Guardrail evaluation for LLM replies — refusal, forbidden strings, citations — the work behind case study 03 on the portfolio.</li>
  </ul>

  <h2>Skills</h2>
  <div class="skills">
    <div><b>Automation:</b> Playwright (TypeScript), Selenium WebDriver, TestComplete (JavaScript), SpecFlow, UI / API / integration / end-to-end testing</div>
    <div><b>Programming:</b> TypeScript, JavaScript, C#</div>
    <div><b>Backend and data:</b> REST API testing, Postman, SQL, PostgreSQL, database validation</div>
    <div><b>CI/CD and tools:</b> GitHub Actions, GitLab CI/CD, GitHub, Docker, Checkly, AWS S3, Lighthouse</div>
    <div><b>Quality engineering:</b> automation architecture, regression and performance testing, QA strategy, defect triage, root cause analysis, synthetic monitoring, code reviews, mentorship</div>
    <div><b>AI-assisted:</b> Claude, Claude Skills, ChatGPT, AI-assisted test generation, autonomous test maintenance</div>
  </div>

  <h2>Education</h2>
  <p>
    ${resume.education.degree} in ${resume.education.field},
    ${resume.education.school}, ${resume.education.graduated}, with a minor in
    ${resume.education.minor}.
  </p>

  <p class="note">
    Portfolio: ${resume.contact.github.replace(/^https?:\/\//, '')}/ — the case studies,
    the release report and the tests behind each claim.
  </p>
</body>
</html>`;

function roleBullets(role) {
  if (role.employer === 'GoFundMe') {
    return `<ul>
      <li>Engineered and maintained automated UI and REST API testing across environments with Playwright and Postman.</li>
      <li>Integrated overnight regression into CI/CD, removing manual test initiation and saving 5+ hours per cycle.</li>
      <li>Owned suites across ${role.repositories} repositories and mentored ${role.engineersMentored} engineers on test design, frameworks and debugging.</li>
    </ul>`;
  }
  if (role.employer === 'Connect for Health Colorado') {
    return `<ul>
      <li>Supervised ${role.analystsSupervised} quality analysts across functional, regression, automation, load and performance testing.</li>
      <li>Expanded automated coverage and cut suite runtime by ${role.runtimeReductionPercent}% across ${role.applicationAreas} application areas.</li>
      <li>Led front-end and back-end defect investigations across three repositories, from root cause to resolution.</li>
    </ul>`;
  }
  if (role.employer === 'Catalyst Healthcare') {
    return `<ul>
      <li>Established the Colorado location's QA department: test planning, automation and release checks across web, mobile and backend.</li>
      <li>Built functional and regression automation with SpecFlow, Selenium WebDriver and C#, and validated SQL data behind the defects.</li>
    </ul>`;
  }
  return `<ul>
    <li>Led mobile testing for the Eternal Card Game: functionality, release readiness, defect reproduction and fix verification.</li>
  </ul>`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: output,
    format: 'Letter',
    printBackground: true,
  });
} finally {
  await browser.close();
}

console.log(`[resume] wrote ${output} from quality/resume.json`);

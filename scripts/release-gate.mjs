#!/usr/bin/env node
/**
 * Turns the release report into a CI verdict without turning the lab's own state into a red
 * build. The seeded defects mean the decision is NOT READY on a healthy run; that is recorded
 * in the job summary and the published report instead of as a build failure. Anything that says
 * the run itself is broken — no summary, a NOT VERIFIED decision, or a gate exit that disagrees
 * with the decision it just wrote — fails the job.
 *
 * Usage: node scripts/release-gate.mjs <exit status of npm run report -- --gate>
 */
import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const status = Number(process.argv[2] ?? '1');
const annotate = (level, message) => console.log(`::${level} title=release gate::${message}`);

let summary;
try {
  summary = JSON.parse(await readFile('artifacts/summary.json', 'utf8'));
} catch {
  annotate('error', 'The report wrote no artifacts/summary.json, so there is nothing to gate.');
  process.exit(1);
}

const reasons = [];
if (summary.openBlockingRisks > 0) {
  reasons.push(`${summary.openBlockingRisks} open high or critical risk(s) in the risk register`);
}
if (!summary.baselineGreen) reasons.push('baseline suites not green or not recorded');
if (!summary.e2eGreen) reasons.push('end-to-end coverage missing or failing');
if (!summary.evalsGreen) reasons.push('an eval version is below its threshold');
if (!summary.loadGreen) reasons.push('load smoke missing or outside its thresholds');
if (!summary.probesGreen) reasons.push('known-defect probes still failing as expected');

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `## Release gate: ${summary.decision}`,
      '',
      ...(reasons.length
        ? reasons.map((reason) => `- ${reason}`)
        : ['- All recorded suites passed and no blocking risks are open.']),
      '',
      'The published report carries the same verdict: `reports/quality-report.html`.',
      '',
    ].join('\n'),
  );
}

if (summary.decision === 'NOT VERIFIED') {
  annotate('error', 'NOT VERIFIED: this run is missing the artifacts the report needs.');
  process.exit(1);
}
if (summary.decision === 'READY' && status !== 0) {
  annotate('error', `The report says READY but the gate exited ${status}.`);
  process.exit(1);
}
if (summary.decision === 'NOT READY' && status === 0) {
  annotate('error', 'The report says NOT READY but the gate exited 0.');
  process.exit(1);
}
if (summary.decision === 'NOT READY') {
  annotate(
    'notice',
    `NOT READY is the expected state while the seeded defects are open: ${reasons.join('; ')}.`,
  );
}
process.exit(0);

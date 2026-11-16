import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Combines the risk register with the latest test evidence into a release verdict
 * that a non-engineer can read.
 */
export async function buildReadiness(rootDir) {
  let risks = [];
  try {
    risks = JSON.parse(await readFile(path.join(rootDir, 'quality', 'risk-register.json'), 'utf8'));
  } catch {
    risks = [];
  }

  let evidence = null;
  try {
    evidence = JSON.parse(await readFile(path.join(rootDir, 'artifacts', 'summary.json'), 'utf8'));
  } catch {
    evidence = null;
  }

  const openBlocking = risks.filter(
    (risk) => risk.status === 'open' && ['critical', 'high'].includes(risk.severity),
  );

  let decision = 'not_verified';
  if (openBlocking.length > 0) decision = 'not_ready';
  else if (evidence?.allGreen === true) decision = 'ready';

  return {
    decision,
    generatedAt: new Date().toISOString(),
    rationale:
      decision === 'ready'
        ? ['All required suites passed in the latest recorded run.', 'No blocking risks are open.']
        : decision === 'not_ready'
          ? [
              `${openBlocking.length} open high/critical risk(s).`,
              ...openBlocking.map((risk) => `${risk.id}: ${risk.summary}`),
            ]
          : ['No recorded test run covers the current build. Run `npm run report` after the suites.'],
    openRisks: risks,
    evidence: evidence ?? { status: 'no_recent_runs' },
  };
}

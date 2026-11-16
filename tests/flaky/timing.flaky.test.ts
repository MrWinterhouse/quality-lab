import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createApplication, createScreening, family4, sleep, withApp } from '../helpers/app.ts';

/**
 * This is a deliberately bad test, kept as a triage exercise.
 *
 * It is not in any baseline suite. Run it with `npm run test:flaky` a few times
 * and write down what you observe before reading docs/answer-key.md.
 */
test('FLAKY-01: worker is done after a fixed 15ms sleep', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);

    await sleep(15);

    const result = await api(app, `/api/applications/${created.body.id}`, {
      token: 'tok_applicant_a',
    });
    assert.equal(result.body.vendor.status, 'verified');
  });
});

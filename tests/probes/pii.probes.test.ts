import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createApplication, createScreening, family4, TOKENS, withApp } from '../helpers/app.ts';

test('DEFECT-06: Social Security numbers are masked in responses and events', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);

    assert.equal(created.status, 201);
    assert.equal(created.body.applicant.ssn, '***-**-6789', 'response must mask the SSN');

    const events = await api(app, `/api/applications/${created.body.id}/events`, {
      token: TOKENS.caseworkerA,
    });
    assert.ok(
      !JSON.stringify(events.body).includes('123-45-6789'),
      'timeline events must not contain raw SSNs',
    );

    const detail = await api(app, `/api/applications/${created.body.id}`, {
      token: TOKENS.caseworkerA,
    });
    assert.ok(
      !JSON.stringify(detail.body).includes('123-45-6789'),
      'application detail must not contain raw SSNs',
    );
  });
});

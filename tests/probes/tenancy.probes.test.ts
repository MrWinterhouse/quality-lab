import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createScreening, family4, TOKENS, withApp } from '../helpers/app.ts';

test('DEFECT-04: tenant configuration is isolated between agencies', async () => {
  await withApp(async (app) => {
    const agencyA = await api(app, '/api/config', { token: TOKENS.applicantA });
    const agencyB = await api(app, '/api/config', { token: TOKENS.applicantB });

    assert.equal(agencyA.body.brandName, 'Northstar Benefits');
    assert.equal(agencyB.body.tenantId, 'agency-b', 'agency B must not receive agency A branding');
    assert.equal(agencyB.body.brandName, 'Riverbend Access');
    assert.deepEqual(agencyB.body.enabledPrograms, ['medicaid', 'chip']);
    assert.equal(agencyB.body.deadlineDays, 30);
  });
});

test('DEFECT-05: an applicant cannot read another applicant screening by id', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4(), TOKENS.applicantA);

    const crossTenantRead = await api(app, `/api/screenings/${screening.id}`, {
      token: TOKENS.applicantB,
    });
    assert.equal(crossTenantRead.status, 403);

    const sameTenantRead = await api(app, `/api/screenings/${screening.id}`, {
      token: TOKENS.applicantA,
    });
    assert.equal(sameTenantRead.status, 200);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  configureVendor,
  createApplication,
  createScreening,
  family4,
  TOKENS,
  waitForApplication,
  withApp,
} from '../helpers/app.ts';

test('DEFECT-09: approval requires proof of income and a successful verification', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    await waitForApplication(app, created.body.id, (application) => application.vendor.status === 'verified');

    await api(app, `/api/applications/${created.body.id}/review`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: {},
    });

    const approvedWithoutDocuments = await api(
      app,
      `/api/applications/${created.body.id}/decision`,
      {
        method: 'POST',
        token: TOKENS.caseworkerA,
        body: { decision: 'approved', note: 'No documents on file.' },
      },
    );

    assert.equal(approvedWithoutDocuments.status, 409);
    assert.equal(approvedWithoutDocuments.body.error.code, 'missing_requirements');
  });
});

test('DEFECT-09b: approval requires a verified vendor result', async () => {
  await withApp(async (app) => {
    await configureVendor(app, { alwaysFail: true });
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    await waitForApplication(app, created.body.id, (application) => application.vendor.status === 'failed');

    await api(app, `/api/applications/${created.body.id}/documents`, {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { type: 'income_proof', fileName: 'paystub.pdf', sizeBytes: 400 },
    });
    await api(app, `/api/applications/${created.body.id}/review`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: {},
    });
    const approved = await api(app, `/api/applications/${created.body.id}/decision`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: { decision: 'approved' },
    });

    assert.equal(approved.status, 409);
    assert.equal(approved.body.error.code, 'missing_requirements');
  });
});

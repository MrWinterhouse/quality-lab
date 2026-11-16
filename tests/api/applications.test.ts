import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  createApplication,
  createScreening,
  family4,
  TOKENS,
  waitForApplication,
  withApp,
} from '../helpers/app.ts';

test('application happy path: verify, document, review, approve', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'submitted');
    assert.match(created.body.deadlineDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(created.body.vendor.status, 'pending');

    const applicationId = created.body.id;
    await waitForApplication(app, applicationId, (application) => application.vendor.status === 'verified');

    const uploaded = await api(app, `/api/applications/${applicationId}/documents`, {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { type: 'income_proof', fileName: 'paystub.pdf', sizeBytes: 2048 },
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.status, 'documents_pending');
    assert.equal(uploaded.body.document.type, 'income_proof');

    const review = await api(app, `/api/applications/${applicationId}/review`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: { note: 'Documents look complete.' },
    });
    assert.equal(review.status, 200);
    assert.equal(review.body.status, 'under_review');

    const decision = await api(app, `/api/applications/${applicationId}/decision`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: { decision: 'approved', note: 'Income verified.' },
    });
    assert.equal(decision.status, 200);
    assert.equal(decision.body.status, 'approved');

    const timelineTypes = decision.body.timeline.map((event: any) => event.type);
    assert.deepEqual(timelineTypes, [
      'application.submitted',
      'vendor.verified',
      'document.received',
      'application.under_review',
      'application.approved',
    ]);
  });
});

test('denial path does not require a document', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    await waitForApplication(app, created.body.id, (application) => application.vendor.status === 'verified');

    await api(app, `/api/applications/${created.body.id}/review`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: {},
    });
    const decision = await api(app, `/api/applications/${created.body.id}/decision`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: { decision: 'denied', note: 'Outside program rules.' },
    });

    assert.equal(decision.status, 200);
    assert.equal(decision.body.status, 'denied');
    assert.equal(decision.body.timeline.at(-1).type, 'application.denied');
  });
});

test('applicants cannot read or decide another applicant application', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4(), TOKENS.applicantA);
    const created = await createApplication(app, screening.id, TOKENS.applicantA);

    const otherApplicant = await api(app, `/api/applications/${created.body.id}`, {
      token: TOKENS.applicantB,
    });
    assert.equal(otherApplicant.status, 403);

    const otherCaseworker = await api(app, `/api/applications/${created.body.id}`, {
      token: TOKENS.caseworkerB,
    });
    assert.equal(otherCaseworker.status, 403);

    const crossTenantDecision = await api(
      app,
      `/api/applications/${created.body.id}/decision`,
      { method: 'POST', token: TOKENS.caseworkerB, body: { decision: 'approved' } },
    );
    assert.equal(crossTenantDecision.status, 403);
  });
});

test('applicants cannot perform caseworker transitions', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);

    const review = await api(app, `/api/applications/${created.body.id}/review`, {
      method: 'POST',
      token: TOKENS.applicantA,
      body: {},
    });
    assert.equal(review.status, 403);
  });
});

test('decisions require an under-review application and a valid value', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);

    const tooEarly = await api(app, `/api/applications/${created.body.id}/decision`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: { decision: 'approved' },
    });
    assert.equal(tooEarly.status, 409);

    await api(app, `/api/applications/${created.body.id}/review`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: {},
    });

    const invalid = await api(app, `/api/applications/${created.body.id}/decision`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: { decision: 'maybe' },
    });
    assert.equal(invalid.status, 400);
  });
});

test('document uploads validate type and size', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);

    const badType = await api(app, `/api/applications/${created.body.id}/documents`, {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { type: 'selfie', fileName: 'x.png', sizeBytes: 10 },
    });
    assert.equal(badType.status, 400);

    const badSize = await api(app, `/api/applications/${created.body.id}/documents`, {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { type: 'id', fileName: 'x.png', sizeBytes: 0 },
    });
    assert.equal(badSize.status, 400);
  });
});

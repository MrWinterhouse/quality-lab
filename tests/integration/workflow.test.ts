import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  configureVendor,
  createApplication,
  createScreening,
  family4,
  signPayload,
  sleep,
  TOKENS,
  VENDOR_SECRETS,
  vendorState,
  waitForApplication,
  withApp,
} from '../helpers/app.ts';

test('screening to approval crosses API, worker, vendor and persistence seams', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    const applicationId = created.body.id;

    const verified = await waitForApplication(
      app,
      applicationId,
      (application) => application.vendor.status === 'verified',
    );
    assert.ok(verified.vendor.verificationId);
    assert.equal(verified.status, 'submitted');

    const state = await vendorState(app);
    const records = state.verifications.filter(
      (record: any) => record.applicationId === applicationId,
    );
    assert.equal(records.length, 1, 'one submission must produce one vendor verification');
    assert.equal(records[0].householdHash, created.body.householdHash);

    await api(app, `/api/applications/${applicationId}/documents`, {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { type: 'income_proof', fileName: 'paystub.pdf', sizeBytes: 900 },
    });
    await api(app, `/api/applications/${applicationId}/review`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: {},
    });
    const decision = await api(app, `/api/applications/${applicationId}/decision`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: { decision: 'approved' },
    });

    assert.equal(decision.body.status, 'approved');
    const events = await api(app, `/api/applications/${applicationId}/events`, {
      token: TOKENS.caseworkerA,
    });
    assert.deepEqual(
      events.body.events.map((event: any) => event.type),
      [
        'application.submitted',
        'vendor.verified',
        'document.received',
        'application.under_review',
        'application.approved',
      ],
    );
  });
});

test('an unavailable vendor is retried and surfaced without corrupting status', async () => {
  await withApp(async (app) => {
    await configureVendor(app, { alwaysFail: true });
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);

    const failed = await waitForApplication(
      app,
      created.body.id,
      (application) => application.vendor.status === 'failed',
    );
    assert.equal(failed.status, 'submitted');
    assert.equal(failed.vendor.reason, 'vendor_unavailable');
    assert.equal((await vendorState(app)).attempts, 3);
    assert.equal(
      failed.timeline.filter((event: any) => event.type === 'vendor.failed').length,
      1,
    );
  });
});

test('signed vendor webhooks update the application and reject bad signatures', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    await waitForApplication(app, created.body.id, (application) => application.vendor.status === 'verified');

    const body = JSON.stringify({
      applicationId: created.body.id,
      verificationId: 'vrf_webhook_1',
      result: 'verified',
      householdHash: created.body.householdHash,
    });
    const timestamp = Math.floor(Date.now() / 1000);

    const rejected = await fetch(`${app.url}/api/webhooks/vendor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant': 'agency-a',
        'x-timestamp': String(timestamp),
        'x-signature': 'deadbeef',
      },
      body,
    });
    assert.equal(rejected.status, 401);

    const accepted = await fetch(`${app.url}/api/webhooks/vendor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant': 'agency-a',
        'x-timestamp': String(timestamp),
        'x-signature': signPayload(VENDOR_SECRETS['agency-a'], timestamp, body),
      },
      body,
    });
    assert.equal(accepted.status, 200);

    const events = await api(app, `/api/applications/${created.body.id}/events`, {
      token: TOKENS.caseworkerA,
    });
    assert.ok(events.body.events.some((event: any) => event.type === 'vendor.webhook_received'));
  });
});

test('a mismatched household hash is recorded as a data-integrity event', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    await sleep(25);

    const body = JSON.stringify({
      applicationId: created.body.id,
      verificationId: 'vrf_mismatch_1',
      result: 'verified',
      householdHash: 'f'.repeat(64),
    });
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await fetch(`${app.url}/api/webhooks/vendor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant': 'agency-a',
        'x-timestamp': String(timestamp),
        'x-signature': signPayload(VENDOR_SECRETS['agency-a'], timestamp, body),
      },
      body,
    });
    assert.equal(response.status, 202);

    const application = await api(app, `/api/applications/${created.body.id}`, {
      token: TOKENS.caseworkerA,
    });
    assert.equal(application.body.vendor.status, 'mismatch');
    assert.ok(
      application.body.timeline.some((event: any) => event.type === 'vendor.data_mismatch'),
    );
  });
});

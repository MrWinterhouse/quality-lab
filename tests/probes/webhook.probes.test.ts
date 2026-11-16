import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApplication,
  createScreening,
  family4,
  signPayload,
  VENDOR_SECRETS,
  waitForApplication,
  withApp,
} from '../helpers/app.ts';

test('DEFECT-08: vendor webhooks reject replayed timestamps', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    await waitForApplication(app, created.body.id, (application) => application.vendor.status === 'verified');

    const raw = JSON.stringify({
      applicationId: created.body.id,
      verificationId: 'vrf_replay_1',
      result: 'verified',
      householdHash: created.body.householdHash,
    });

    const staleTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const stale = await fetch(`${app.url}/api/webhooks/vendor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant': 'agency-a',
        'x-timestamp': String(staleTimestamp),
        'x-signature': signPayload(VENDOR_SECRETS['agency-a'], staleTimestamp, raw),
      },
      body: raw,
    });
    assert.equal(stale.status, 401, 'a one-hour-old signed request must be rejected');
    const staleBody = await stale.json();
    assert.equal(staleBody.error.code, 'stale_signature');
  });
});

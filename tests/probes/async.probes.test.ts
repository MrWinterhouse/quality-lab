import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureVendor,
  createApplication,
  createScreening,
  family4,
  TOKENS,
  vendorState,
  waitForApplication,
  withApp,
} from '../helpers/app.ts';

test('DEFECT-07: a retried vendor call reuses its idempotency key', async () => {
  await withApp(async (app) => {
    await configureVendor(app, { failAfterRecord: 1 });

    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    await waitForApplication(
      app,
      created.body.id,
      (application) => application.vendor.status === 'verified',
    );

    const state = await vendorState(app);
    const records = state.verifications.filter(
      (record: any) => record.applicationId === created.body.id,
    );

    assert.equal(
      records.length,
      1,
      'a timeout after processing must not create a second vendor verification',
    );
    assert.ok(state.attempts >= 2, 'the worker should have retried at least once');
  });
});

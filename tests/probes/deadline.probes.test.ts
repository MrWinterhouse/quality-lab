import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApplication,
  createScreening,
  family4,
  setClock,
  withApp,
} from '../helpers/app.ts';

test('DEFECT-10: deadlines are calculated in the agency timezone', async () => {
  await withApp(async (app) => {
    // 02:00 UTC on Nov 16 is still 18:00 on Nov 15 in Los Angeles.
    await setClock(app, '2026-11-16T02:00:00.000Z');

    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);

    assert.equal(created.status, 201);
    assert.equal(
      created.body.deadlineDate,
      '2026-11-25',
      'ten days from the local submission date (Nov 15) is Nov 25',
    );
    assert.equal(created.body.deadline, '2026-11-26T07:59:59.999Z');
  });
});

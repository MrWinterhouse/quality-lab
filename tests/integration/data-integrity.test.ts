import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  createApplication,
  createScreening,
  family4,
  TOKENS,
  withApp,
} from '../helpers/app.ts';

test('household hashes are stable across equivalent payloads', async () => {
  await withApp(async (app) => {
    const first = await createScreening(app, family4());
    const reordered = {
      incomeComplete: true,
      householdSize: 4,
      state: 'CA',
      members: family4().members.map((member: any) => ({
        income: member.income,
        status: member.status,
        age: member.age,
      })),
    };
    const second = await createScreening(app, reordered);

    const appOne = await createApplication(app, first.id);
    const appTwo = await createApplication(app, second.id);

    assert.equal(appOne.status, 201);
    assert.equal(appTwo.status, 201);
    assert.equal(appOne.body.householdHash, appTwo.body.householdHash);
  });
});

test('reported poverty percentage is consistent with income and FPL', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4({ income: 2750 }));
    const expected = Number(((screening.annualIncome / screening.fplAnnual) * 100).toFixed(1));
    assert.equal(screening.fplPercent, expected);
    assert.equal(screening.annualIncome, 2750 * 12);
  });
});

test('the application keeps its verification snapshot after the screening changes', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);

    const storedScreening = app.store.screenings.get(screening.id);
    storedScreening.input.members[0].age = 99;

    const fetched = await api(app, `/api/applications/${created.body.id}`, {
      token: TOKENS.caseworkerA,
    });
    assert.equal(fetched.body.householdHash, created.body.householdHash);
  });
});

test('documents only move submitted applications into documents_pending', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const created = await createApplication(app, screening.id);
    await api(app, `/api/applications/${created.body.id}/review`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: {},
    });

    const uploaded = await api(app, `/api/applications/${created.body.id}/documents`, {
      method: 'POST',
      token: TOKENS.caseworkerA,
      body: { type: 'income_proof', fileName: 'after-review.pdf', sizeBytes: 120 },
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.status, 'under_review');

    const application = await api(app, `/api/applications/${created.body.id}`, {
      token: TOKENS.caseworkerA,
    });
    assert.equal(application.body.documents.length, 1);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  createScreening,
  family4,
  household,
  TOKENS,
  withApp,
} from '../helpers/app.ts';

test('health endpoint is public', async () => {
  await withApp(async (app) => {
    const result = await api(app, '/health');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'ok');
  });
});

test('tenant config exposes branding and enabled programs', async () => {
  await withApp(async (app) => {
    const result = await api(app, '/api/config', { token: TOKENS.applicantA });
    assert.equal(result.status, 200);
    assert.equal(result.body.tenantId, 'agency-a');
    assert.equal(result.body.brandName, 'Northstar Benefits');
    assert.deepEqual(result.body.enabledPrograms, ['medicaid', 'snap', 'wic', 'chip']);
    assert.equal(result.body.deadlineDays, 10);
  });
});

test('program listing includes thresholds for a household', async () => {
  await withApp(async (app) => {
    const result = await api(app, '/api/programs?state=CA&householdSize=4', {
      token: TOKENS.applicantA,
    });
    assert.equal(result.status, 200);
    const medicaid = result.body.programs.find((program: any) => program.id === 'medicaid');
    assert.equal(medicaid.thresholdPct, 138);
    assert.equal(medicaid.incomeLimitAnnual, 44367);
  });
});

test('a low-income family of four screens eligible for all four programs', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());

    assert.equal(screening.householdSize, 4);
    assert.equal(screening.annualIncome, 24000);
    assert.equal(screening.fplPercent, 74.7);
    assert.equal(screening.results.length, 4);

    const byProgram = Object.fromEntries(
      screening.results.map((result: any) => [result.programId, result]),
    );
    for (const program of ['medicaid', 'snap', 'wic', 'chip']) {
      assert.equal(byProgram[program].status, 'likely_eligible', program);
      assert.ok(byProgram[program].fplPercent > 0);
    }
  });
});

test('incomplete income produces need_more_info instead of a guess', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4({ income: 0 }));
    const incomplete = await createScreening(app, {
      ...family4(),
      incomeComplete: false,
    });

    assert.equal(screening.results[0].status, 'likely_eligible');
    for (const result of incomplete.results) {
      assert.equal(result.status, 'need_more_info');
      assert.equal(result.reason, 'income_incomplete');
      assert.deepEqual(result.missing, ['income']);
    }
  });
});

test('WIC requires a pregnant person or a child under five', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, household());

    const wic = screening.results.find((result: any) => result.programId === 'wic');
    assert.equal(wic.status, 'likely_ineligible');
    assert.equal(wic.reason, 'no_categorical_member');
  });
});

test('undocumented household members block Medicaid and SNAP', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(
      app,
      household({
        householdSize: 2,
        members: [
          { age: 35, status: 'undocumented', income: { amount: 500, frequency: 'monthly' } },
          { age: 8, status: 'citizen' },
        ],
      }),
    );

    const byProgram = Object.fromEntries(
      screening.results.map((result: any) => [result.programId, result]),
    );
    assert.equal(byProgram.medicaid.status, 'likely_ineligible');
    assert.equal(byProgram.medicaid.reason, 'immigration_status');
    assert.equal(byProgram.snap.reason, 'immigration_status');
    assert.equal(byProgram.wic.status, 'likely_ineligible');
  });
});

test('invalid household payloads return a 400 with actionable details', async () => {
  await withApp(async (app) => {
    const badState = await api(app, '/api/screenings', {
      token: TOKENS.applicantA,
      body: household({ state: 'ZZ' }),
    });
    assert.equal(badState.status, 400);
    assert.equal(badState.body.error.code, 'invalid_household');
    assert.ok(badState.body.error.details.includes('state_invalid'));

    const badAge = await api(app, '/api/screenings', {
      token: TOKENS.applicantA,
      body: household({
        members: [{ age: -1, income: { amount: 100, frequency: 'monthly' } }],
        householdSize: 1,
      }),
    });
    assert.equal(badAge.status, 400);
    assert.ok(badAge.body.error.details.includes('members[0].age_invalid'));
  });
});

test('screening endpoints require authentication and known ids', async () => {
  await withApp(async (app) => {
    const anonymous = await api(app, '/api/screening', { method: 'GET' });
    assert.equal(anonymous.status, 404);

    const noToken = await api(app, '/api/screenings', { method: 'POST', body: household() });
    assert.equal(noToken.status, 401);

    const missing = await api(app, '/api/screenings/scr_99999', { token: TOKENS.applicantA });
    assert.equal(missing.status, 404);
  });
});

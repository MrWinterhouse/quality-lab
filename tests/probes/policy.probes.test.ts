import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createScreening, family4, household, TOKENS, withApp } from '../helpers/app.ts';

/**
 * These probes encode the intended behavior. They fail against the seeded defects.
 * Triage them in order: reproduce, isolate, write a bug report, fix, re-run.
 */

test('DEFECT-01: biweekly pay is annualized from 26 pay periods, not 24', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4({ income: 1800, frequency: 'biweekly' }));
    const medicaid = screening.results.find((result: any) => result.programId === 'medicaid');

    assert.equal(screening.annualIncome, 46_800, '1800 every two weeks is 26 payments a year');
    assert.equal(
      medicaid.status,
      'likely_ineligible',
      '46,800 is 145.6% of FPL, above the 138% Medicaid limit',
    );
  });
});

test('DEFECT-02: Alaska and Hawaii use their own poverty guidelines', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(
      app,
      household({
        state: 'AK',
        householdSize: 1,
        members: [
          { age: 35, status: 'citizen', income: { amount: 1834, frequency: 'monthly' } },
        ],
      }),
    );
    const medicaid = screening.results.find((result: any) => result.programId === 'medicaid');

    assert.equal(screening.annualIncome, 22_008);
    assert.equal(medicaid.status, 'likely_eligible', '112% of the Alaska guideline is under 138%');
  });
});

test('DEFECT-03: household size must be positive and agree with member records', async () => {
  await withApp(async (app) => {
    const zeroSize = await api(app, '/api/screenings', {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { ...household(), householdSize: 0, members: [] },
    });
    assert.equal(zeroSize.status, 400, 'a zero-person household is not screenable');
    assert.equal(zeroSize.body.error.code, 'invalid_household');

    const mismatched = await api(app, '/api/screenings', {
      method: 'POST',
      token: TOKENS.applicantA,
      body: {
        ...household(),
        householdSize: 4,
        members: [household().members[0]],
      },
    });
    assert.equal(mismatched.status, 400, 'householdSize must equal members.length');
    assert.ok(
      mismatched.body.error.details.includes('householdSize_member_mismatch'),
      'the error should explain the mismatch',
    );
  });
});

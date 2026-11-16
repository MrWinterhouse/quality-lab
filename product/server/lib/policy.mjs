/**
 * Eligibility policy for the lab.
 *
 * The numbers here are a simplified, non-authoritative snapshot for testing practice.
 * They are NOT legal or policy advice.
 */

export const FPL_2026 = Object.freeze({
  baseAnnual: [15650, 21150, 26650, 32150, 37650, 43150, 48650, 54150],
  perAdditionalPerson: 5500,
});

export const US_STATES = Object.freeze([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE',
  'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD',
  'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

export const MEDICAID_EXPANSION_STATES = Object.freeze([
  'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'HI', 'ID', 'IL', 'IN', 'IA', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OR', 'PA', 'RI', 'SD', 'UT', 'VT', 'VA', 'WA', 'WV',
]);

export const PROGRAM_RULES = Object.freeze({
  medicaid: { label: 'Medicaid', requiresLawfulStatus: true },
  snap: { label: 'SNAP', requiresLawfulStatus: true, incomeLimitPct: 1.3 },
  wic: { label: 'WIC', requiresLawfulStatus: false, incomeLimitPct: 1.85 },
  chip: { label: 'CHIP', requiresLawfulStatus: true, incomeLimitPct: 2.0 },
});

export const INCOME_FREQUENCIES = Object.freeze([
  'hourly', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'annual',
]);

export function fplAnnual(householdSize, state) {
  const size = Math.max(1, Math.floor(Number(householdSize) || 1));
  const base =
    size <= FPL_2026.baseAnnual.length
      ? FPL_2026.baseAnnual[size - 1]
      : FPL_2026.baseAnnual[FPL_2026.baseAnnual.length - 1] +
        (size - FPL_2026.baseAnnual.length) * FPL_2026.perAdditionalPerson;

  const stateMultiplier = 1;
  return Math.round(base * stateMultiplier);
}

export function annualizeIncome(source) {
  if (!source) return 0;
  const amount = Number(source.amount ?? 0);
  const hoursPerWeek = Number(source.hoursPerWeek ?? 40);
  if (!Number.isFinite(amount)) return Number.NaN;

  switch (source.frequency) {
    case 'hourly':
      return amount * hoursPerWeek * 52;
    case 'weekly':
      return amount * 52;
    case 'biweekly':
      return amount * 24;
    case 'semimonthly':
      return amount * 24;
    case 'monthly':
      return amount * 12;
    case 'annual':
      return amount;
    default:
      return Number.NaN;
  }
}

export function annualHouseholdIncome(members) {
  return members.reduce((total, member) => total + annualizeIncome(member.income), 0);
}

/**
 * Structural validation only. Business rules (minimum household size, member/size
 * consistency) live in the eligibility layer in a full implementation.
 */
export function validateHousehold(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['body_required'] };
  }

  if (!US_STATES.includes(input.state)) errors.push('state_invalid');

  if (!Number.isInteger(input.householdSize)) {
    errors.push('householdSize_invalid');
  }

  if (!Array.isArray(input.members)) {
    errors.push('members_required');
  } else {
    input.members.forEach((member, index) => {
      if (!member || typeof member !== 'object') {
        errors.push(`members[${index}].invalid`);
        return;
      }
      if (!Number.isInteger(member.age) || member.age < 0 || member.age > 120) {
        errors.push(`members[${index}].age_invalid`);
      }
      if (member.income !== undefined && member.income !== null) {
        if (!INCOME_FREQUENCIES.includes(member.income.frequency)) {
          errors.push(`members[${index}].income_frequency_invalid`);
        }
        const amount = Number(member.income.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          errors.push(`members[${index}].income_amount_invalid`);
        }
      }
    });
  }

  if (typeof input.incomeComplete !== 'boolean') errors.push('incomeComplete_required');

  return { ok: errors.length === 0, errors };
}

function statusFor(programId, rule, context) {
  const { fplPercent, annualIncome, state, hasYoungChild, hasChild, pregnant, allLawful, incomeComplete } = context;
  const base = {
    programId,
    label: rule.label,
    fplPercent,
    missing: [],
  };

  if (incomeComplete === false) {
    return { ...base, status: 'need_more_info', reason: 'income_incomplete', missing: ['income'] };
  }

  if (programId === 'wic') {
    if (!hasYoungChild && !pregnant) {
      return { ...base, status: 'likely_ineligible', reason: 'no_categorical_member' };
    }
    const limitPct = rule.incomeLimitPct;
    const limitAnnual = Math.round(fplAnnual(context.householdSize, state) * limitPct);
    return {
      ...base,
      status: annualIncome <= limitAnnual ? 'likely_eligible' : 'likely_ineligible',
      reason: annualIncome <= limitAnnual ? 'income_within_limit' : 'income_above_limit',
      thresholdPct: Math.round(limitPct * 100),
      incomeLimitAnnual: limitAnnual,
    };
  }

  if (programId === 'chip' && !hasChild) {
    return { ...base, status: 'likely_ineligible', reason: 'no_child' };
  }

  if (rule.requiresLawfulStatus && !allLawful) {
    return { ...base, status: 'likely_ineligible', reason: 'immigration_status' };
  }

  let limitPct = rule.incomeLimitPct;
  if (programId === 'medicaid') {
    limitPct = MEDICAID_EXPANSION_STATES.includes(state) ? 1.38 : 1.0;
  }

  const limitAnnual = Math.round(fplAnnual(context.householdSize, state) * limitPct);
  const eligible = annualIncome <= limitAnnual;

  return {
    ...base,
    status: eligible ? 'likely_eligible' : 'likely_ineligible',
    reason: eligible ? 'income_within_limit' : 'income_above_limit',
    thresholdPct: Math.round(limitPct * 100),
    incomeLimitAnnual: limitAnnual,
  };
}

export function screenHousehold(input) {
  const fpl = fplAnnual(input.householdSize, input.state);
  const annualIncome = annualHouseholdIncome(input.members);
  const fplPercent = Number(((annualIncome / fpl) * 100).toFixed(1));

  const context = {
    state: input.state,
    householdSize: input.householdSize,
    annualIncome,
    fplPercent,
    incomeComplete: input.incomeComplete,
    allLawful: input.members.every((member) => member.status !== 'undocumented'),
    hasYoungChild: input.members.some((member) => member.age < 5),
    hasChild: input.members.some((member) => member.age < 19),
    pregnant: input.members.some((member) => member.pregnant === true),
  };

  const results = Object.entries(PROGRAM_RULES).map(([programId, rule]) =>
    statusFor(programId, rule, context),
  );

  return { fplAnnual: fpl, annualIncome, fplPercent, results };
}

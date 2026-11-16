/**
 * Deterministic test-data builders.
 *
 * Prefer these over copy-pasted payloads: they make the interesting dimension explicit
 * and keep unrelated fields stable when a test changes.
 */

export interface IncomeSource {
  amount: number;
  frequency: 'hourly' | 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'annual';
  hoursPerWeek?: number;
}

export interface Member {
  age: number;
  status?: 'citizen' | 'qualified_immigrant' | 'undocumented';
  pregnant?: boolean;
  income?: IncomeSource;
}

export interface Household {
  state: string;
  householdSize: number;
  incomeComplete: boolean;
  members: Member[];
}

export function member(overrides: Partial<Member> = {}): Member {
  return { age: 35, status: 'citizen', ...overrides };
}

export function income(
  amount: number,
  frequency: IncomeSource['frequency'] = 'monthly',
  hoursPerWeek?: number,
): IncomeSource {
  return { amount, frequency, ...(hoursPerWeek === undefined ? {} : { hoursPerWeek }) };
}

export function household(overrides: Partial<Household> = {}): Household {
  return {
    state: 'CA',
    householdSize: 2,
    incomeComplete: true,
    members: [member({ age: 35, income: income(2000) }), member({ age: 33 })],
    ...overrides,
  };
}

export function family4({
  income: monthlyIncome = 2000,
  frequency = 'monthly',
  state = 'CA',
}: {
  income?: number;
  frequency?: IncomeSource['frequency'];
  state?: string;
} = {}): Household {
  return {
    state,
    householdSize: 4,
    incomeComplete: true,
    members: [
      member({ age: 35, income: income(monthlyIncome, frequency) }),
      member({ age: 33 }),
      member({ age: 9 }),
      member({ age: 3 }),
    ],
  };
}

export function singleAdult({
  state = 'CA',
  amount = 2000,
  frequency = 'monthly',
  status = 'citizen',
}: {
  state?: string;
  amount?: number;
  frequency?: IncomeSource['frequency'];
  status?: Member['status'];
} = {}): Household {
  return {
    state,
    householdSize: 1,
    incomeComplete: true,
    members: [member({ age: 35, status, income: income(amount, frequency) })],
  };
}

/** Named cases for a tenant/state matrix. Keep the names in the failure output. */
export function householdMatrix(): Array<{ name: string; household: Household }> {
  return [
    { name: 'CA family of four, monthly', household: family4() },
    { name: 'CA family of four, biweekly', household: family4({ income: 1800, frequency: 'biweekly' }) },
    { name: 'AK single adult, monthly', household: singleAdult({ state: 'AK', amount: 1834 }) },
    { name: 'HI single adult, monthly', household: singleAdult({ state: 'HI', amount: 2100 }) },
    {
      name: 'TX family of two, no income',
      household: household({
        state: 'TX',
        members: [member({ age: 30, income: income(0) }), member({ age: 4 })],
      }),
    },
    {
      name: 'Mixed-status household',
      household: household({
        members: [
          member({ age: 35, status: 'undocumented', income: income(500) }),
          member({ age: 8 }),
        ],
      }),
    },
  ];
}

/** Small deterministic PRNG for generated data; never Math.random() in a test fixture. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

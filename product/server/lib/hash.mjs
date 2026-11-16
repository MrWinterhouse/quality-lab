import { createHash } from 'node:crypto';

/** Deterministic hash of the household facts that a vendor verification must match. */
export function hashHousehold(input) {
  const normalized = {
    state: String(input.state ?? ''),
    householdSize: Number(input.householdSize ?? 0),
    incomeComplete: Boolean(input.incomeComplete),
    members: (input.members ?? []).map((member) => ({
      age: Number(member.age ?? 0),
      pregnant: Boolean(member.pregnant),
      status: String(member.status ?? 'citizen'),
      income: member.income
        ? {
            amount: Number(member.income.amount ?? 0),
            frequency: String(member.income.frequency ?? 'annual'),
            hoursPerWeek: Number(member.income.hoursPerWeek ?? 40),
          }
        : null,
    })),
  };

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

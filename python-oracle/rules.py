"""Reference implementation of the eligibility rules, used as a differential oracle.

Reads a JSON array of household payloads on stdin and prints the expected program
statuses. Standard library only, so it runs anywhere Python 3 is installed.
"""

import json
import math
import sys

FPL_BASE = [15650, 21150, 26650, 32150, 37650, 43150, 48650, 54150]
PER_ADDITIONAL = 5500
STATE_MULTIPLIER = {"AK": 1.25, "HI": 1.70}

EXPANSION_STATES = {
    "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "HI", "ID", "IL", "IN", "IA",
    "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OR", "PA", "RI", "SD", "UT", "VT", "VA",
    "WA", "WV",
}

INCOME_MULTIPLIERS = {
    "hourly": None,
    "weekly": 52,
    "biweekly": 26,
    "semimonthly": 24,
    "monthly": 12,
    "annual": 1,
}


def fpl_annual(household_size, state):
    size = max(1, int(household_size))
    if size <= len(FPL_BASE):
        base = FPL_BASE[size - 1]
    else:
        base = FPL_BASE[-1] + (size - len(FPL_BASE)) * PER_ADDITIONAL
    return int(math.floor(base * STATE_MULTIPLIER.get(state, 1.0) + 0.5))


def annualize_income(source):
    if not source:
        return 0
    amount = float(source.get("amount", 0))
    frequency = source.get("frequency")
    if frequency == "hourly":
        return amount * float(source.get("hoursPerWeek", 40)) * 52
    multiplier = INCOME_MULTIPLIERS.get(frequency)
    if multiplier is None:
        raise ValueError("unknown income frequency: %s" % frequency)
    return amount * multiplier


def screen(case):
    members = case.get("members") or []
    state = case.get("state")
    size = case.get("householdSize")
    fpl = fpl_annual(size, state)
    annual_income = sum(annualize_income(member.get("income")) for member in members)
    fpl_percent = round(annual_income / fpl * 100, 1)

    has_young_child = any(member.get("age", 99) < 5 for member in members)
    has_child = any(member.get("age", 99) < 19 for member in members)
    pregnant = any(member.get("pregnant") is True for member in members)
    all_lawful = all(member.get("status") != "undocumented" for member in members)
    income_complete = case.get("incomeComplete", True)

    def status(limit_pct, requires_lawful=True):
        if income_complete is False:
            return "need_more_info"
        if requires_lawful and not all_lawful:
            return "likely_ineligible"
        limit = int(math.floor(fpl * limit_pct + 0.5))
        return "likely_eligible" if annual_income <= limit else "likely_ineligible"

    medicaid_limit = 1.38 if state in EXPANSION_STATES else 1.0
    results = {
        "medicaid": status(medicaid_limit),
        "snap": status(1.30),
        "chip": status(2.00) if has_child else "likely_ineligible",
    }

    if not (pregnant or has_young_child):
        results["wic"] = "likely_ineligible"
    else:
        results["wic"] = status(1.85, requires_lawful=False)

    results["annualIncome"] = annual_income
    results["fplAnnual"] = fpl
    results["fplPercent"] = fpl_percent
    return results


def main():
    payload = json.load(sys.stdin)
    cases = payload.get("cases", payload) if isinstance(payload, dict) else payload
    print(json.dumps([screen(case) for case in cases]))


if __name__ == "__main__":
    main()

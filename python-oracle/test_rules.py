import unittest

from rules import annualize_income, fpl_annual, screen


def family4(income=2000, frequency="monthly", state="CA"):
    return {
        "state": state,
        "householdSize": 4,
        "incomeComplete": True,
        "members": [
            {"age": 35, "status": "citizen", "income": {"amount": income, "frequency": frequency}},
            {"age": 33, "status": "citizen"},
            {"age": 9, "status": "citizen"},
            {"age": 3, "status": "citizen"},
        ],
    }


class RulesTests(unittest.TestCase):
    def test_alaska_guideline_multiplier(self):
        self.assertEqual(fpl_annual(1, "AK"), 19563)
        self.assertEqual(fpl_annual(1, "HI"), 26605)
        self.assertEqual(fpl_annual(4, "CA"), 32150)

    def test_biweekly_pay_has_26_periods(self):
        self.assertEqual(annualize_income({"amount": 1800, "frequency": "biweekly"}), 46800)
        self.assertEqual(annualize_income({"amount": 1800, "frequency": "semimonthly"}), 43200)

    def test_low_income_family_is_eligible_for_all_programs(self):
        results = screen(family4())
        for program in ("medicaid", "snap", "wic", "chip"):
            self.assertEqual(results[program], "likely_eligible", program)

    def test_biweekly_borderline_family_is_over_medicaid_limit(self):
        results = screen(family4(income=1800, frequency="biweekly"))
        self.assertEqual(results["annualIncome"], 46800)
        self.assertEqual(results["medicaid"], "likely_ineligible")

    def test_alaska_borderline_household_is_eligible(self):
        case = {
            "state": "AK",
            "householdSize": 1,
            "incomeComplete": True,
            "members": [
                {"age": 35, "status": "citizen", "income": {"amount": 1834, "frequency": "monthly"}}
            ],
        }
        self.assertEqual(screen(case)["medicaid"], "likely_eligible")

    def test_undocumented_member_blocks_medicaid(self):
        case = {
            "state": "CA",
            "householdSize": 2,
            "incomeComplete": True,
            "members": [
                {"age": 35, "status": "undocumented", "income": {"amount": 500, "frequency": "monthly"}},
                {"age": 8, "status": "citizen"},
            ],
        }
        self.assertEqual(screen(case)["medicaid"], "likely_ineligible")

    def test_missing_income_returns_need_more_info(self):
        case = family4()
        case["incomeComplete"] = False
        self.assertEqual(screen(case)["snap"], "need_more_info")


if __name__ == "__main__":
    unittest.main()

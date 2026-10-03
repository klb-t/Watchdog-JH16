#!/usr/bin/env python3
"""Independent small counterexamples plus full deterministic replay."""
import json
from pathlib import Path
import unittest

import run


class LineagePilotTests(unittest.TestCase):
    def case(self, docs):
        return {"seed": 0, "scenario": "independent_test_fixture", "documents": docs}

    def doc(self, document_id, origin, text, observed):
        return {"document_id": document_id, "truth_origin": origin, "text": text, "observed_lineage": observed}

    def test_independent_identical_text_is_not_one_origin(self):
        case = self.case([self.doc("a", "x", "same text", "x"), self.doc("b", "y", "same text", "y")])
        hashed = run.evaluate(case, "exact_hash")
        self.assertEqual((hashed["support_groups"], hashed["collapse_excess"], hashed["double_count_excess"]), (1, 1, 0))
        self.assertEqual(run.evaluate(case, "declared_lineage")["support_groups"], 2)

    def test_paraphrases_retain_common_origin(self):
        case = self.case([self.doc("a", "x", "one wording", "x"), self.doc("b", "x", "different wording", "x")])
        self.assertEqual(run.evaluate(case, "exact_hash")["double_count_excess"], 1)
        self.assertEqual(run.evaluate(case, "declared_lineage")["support_groups"], 1)

    def test_missing_lineages_are_not_collapsed_into_null(self):
        case = self.case([self.doc("a", "x", "copy", None), self.doc("b", "x", "copy", None), self.doc("c", "y", "other", None)])
        result = run.evaluate(case, "declared_lineage")
        self.assertEqual((result["support_groups"], result["double_count_excess"], result["collapse_excess"]), (3, 1, 0))

    def test_incorrect_lineage_can_fail_both_directions(self):
        merged = self.case([self.doc("a", "x", "first", "z"), self.doc("b", "y", "second", "z")])
        split = self.case([self.doc("a", "x", "first", "z"), self.doc("b", "x", "second", "w")])
        self.assertEqual(run.evaluate(merged, "declared_lineage")["signed_count_error"], -1)
        self.assertEqual(run.evaluate(split, "declared_lineage")["signed_count_error"], 1)

    def test_truth_cannot_enter_method(self):
        with self.assertRaises(ValueError):
            run.group_observed([self.doc("a", "x", "content", "x")], "declared_lineage")

    def test_corrupted_metadata_controls_keep_document_material(self):
        protocol = run.load_protocol()
        mixed = [scenario for scenario in protocol["scenarios"] if scenario["family"] == "mixed"]
        for seed in protocol["seeds"]:
            views = [[{key: doc[key] for key in ("document_id", "text", "truth_origin")} for doc in run.generate_case(protocol, seed, scenario)["documents"]] for scenario in mixed]
            self.assertTrue(all(view == views[0] for view in views))

    def test_full_recorded_replay_and_receipt_hashes(self):
        raw = Path(__file__).resolve().parent / "raw"
        receipt = json.loads((raw / "receipt.json").read_bytes())
        artifacts = run.core_artifacts()
        self.assertEqual(artifacts, run.core_artifacts())
        for name, payload in sorted(artifacts.items()):
            self.assertEqual(payload, (raw / name).read_bytes(), name)
            self.assertEqual(run.sha256(payload), receipt["outputs"][name]["sha256"], name)
        for name, expected in receipt["inputs"].items():
            self.assertEqual(run.sha256((raw.parent / name).read_bytes()), expected, name)
        results = [json.loads(line) for line in artifacts["results.jsonl"].splitlines()]
        protocol = run.load_protocol()
        self.assertEqual(len(results), len(protocol["seeds"]) * len(protocol["scenarios"]) * len(protocol["methods"]))
        for result in results:
            self.assertEqual(result["signed_count_error"], result["double_count_excess"] - result["collapse_excess"])
            if result["method"] == "declared_lineage" and result["scenario"] in ("independent_unique", "shared_exact", "shared_paraphrase", "independent_identical", "mixed"):
                self.assertEqual((result["double_count_excess"], result["collapse_excess"]), (0, 0))
            if result["method"] == "declared_lineage" and result["scenario"] == "mixed_missing_lineage":
                self.assertGreater(result["double_count_excess"], 0)
            if result["method"] == "declared_lineage" and result["scenario"] == "mixed_false_merge":
                self.assertGreater(result["collapse_excess"], 0)
            if result["method"] == "declared_lineage" and result["scenario"] == "mixed_false_split":
                self.assertGreater(result["double_count_excess"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

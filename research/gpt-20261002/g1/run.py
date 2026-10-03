#!/usr/bin/env python3
"""Offline synthetic lineage accounting pilot. No third-party dependencies."""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import platform
from pathlib import Path
import random
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
FROZEN_PROTOCOL_SHA256 = "62d09d35ea5b9d66a8bb40f9d364a30d9e0f9fd2a5fa26863b859fc1a0f08f00"
CORE_FILES = ("datasets.jsonl", "results.jsonl", "summary.json")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def load_protocol() -> dict:
    payload = (ROOT / "protocol.json").read_bytes()
    if sha256(payload) != FROZEN_PROTOCOL_SHA256:
        raise ValueError("Frozen protocol has changed; create a superseding protocol/run instead.")
    protocol = json.loads(payload)
    if protocol["version"] != 1 or len(set(protocol["seeds"])) != len(protocol["seeds"]):
        raise ValueError("Invalid protocol version or duplicated seeds")
    return protocol


def generate_case(protocol: dict, seed: int, scenario: dict) -> dict:
    p = protocol["parameters"]
    token_rng = random.Random(seed)
    metadata_rng = random.Random(seed + 17)
    tokens = [f"T{i:02d}-{token_rng.getrandbits(64):016x}" for i in range(p["independent_origins"])]
    family = scenario["family"]
    docs = []
    for origin_i in range(p["independent_origins"]):
        origin = f"o{origin_i:03d}"
        copied = family in ("exact_copies", "paraphrases") or (family == "mixed" and origin_i < p["mixed_copied_origins"])
        multiplicity = p["documents_per_copied_origin"] if copied else 1
        token_i = origin_i
        if family == "identical_independent" and origin_i < 2 * p["identical_independent_pairs"]:
            token_i = 2 * (origin_i // 2)
        if family == "mixed" and origin_i >= p["mixed_copied_origins"]:
            pair_i = origin_i - p["mixed_copied_origins"]
            if pair_i < 2 * p["identical_independent_pairs"]:
                token_i = p["mixed_copied_origins"] + 2 * (pair_i // 2)
        for copy_i in range(multiplicity):
            template_i = copy_i % len(p["templates"]) if family in ("paraphrases", "mixed") else 0
            text = p["templates"][template_i].format(token=tokens[token_i])
            observed = origin
            if scenario["lineage"] == "missing" and metadata_rng.random() < p["missing_lineage_probability"]:
                observed = None
            elif scenario["lineage"] == "false_merge" and origin_i < 2 * p["false_merge_pairs"]:
                observed = f"merged-{origin_i // 2:03d}"
            elif scenario["lineage"] == "false_split" and origin_i < p["false_split_origins"]:
                observed = f"split-{origin}-{copy_i:03d}"
            docs.append({
                "document_id": f"d{origin_i:03d}-{copy_i:03d}",
                "text": text,
                "truth_origin": origin,
                "observed_lineage": observed,
            })
    return {"seed": seed, "scenario": scenario["id"], "documents": sorted(docs, key=lambda doc: doc["document_id"])}


def group_observed(observations: list[dict], method: str) -> tuple[dict[str, list[str]], dict]:
    """The method receives no truth_origin or scenario identifier."""
    groups: dict[str, list[str]] = {}
    hashed_bytes = 0
    for doc in sorted(observations, key=lambda doc: doc["document_id"]):
        if "truth_origin" in doc:
            raise ValueError("Ground truth must not enter a grouping method")
        if method == "document_count":
            key = "document:" + doc["document_id"]
        elif method == "exact_hash":
            payload = doc["text"].encode("utf-8")
            key = "sha256:" + sha256(payload)
            hashed_bytes += len(payload)
        elif method == "declared_lineage":
            key = "lineage:" + doc["observed_lineage"] if doc["observed_lineage"] is not None else "missing:" + doc["document_id"]
        else:
            raise ValueError(f"Unknown method: {method}")
        groups.setdefault(key, []).append(doc["document_id"])
    return dict(sorted(groups.items())), {
        "documents_visited": len(observations),
        "utf8_bytes_hashed": hashed_bytes,
        "retained_group_keys": len(groups),
    }


def evaluate(case: dict, method: str) -> dict:
    docs = case["documents"]
    observations = [{key: doc[key] for key in ("document_id", "text", "observed_lineage")} for doc in docs]
    groups, cost = group_observed(observations, method)
    truth_by_document = {doc["document_id"]: doc["truth_origin"] for doc in docs}
    origins = sorted(set(truth_by_document.values()))
    origin_memberships = {origin: 0 for origin in origins}
    collapse = 0
    merged_pairs = set()
    for members in groups.values():
        present_origins = sorted({truth_by_document[document_id] for document_id in members})
        collapse += max(0, len(present_origins) - 1)
        merged_pairs.update(itertools.combinations(present_origins, 2))
        for origin in present_origins:
            origin_memberships[origin] += 1
    double_count = sum(max(0, n - 1) for n in origin_memberships.values())
    error = len(groups) - len(origins)
    if error != double_count - collapse:
        raise AssertionError("Accounting identity failed")
    return {
        "seed": case["seed"], "scenario": case["scenario"], "method": method,
        "documents": len(docs), "truth_origins": len(origins), "support_groups": len(groups),
        "signed_count_error": error, "double_count_excess": double_count,
        "collapse_excess": collapse, "merged_independent_pairs": len(merged_pairs),
        "missing_lineage_documents": sum(doc["observed_lineage"] is None for doc in docs),
        "cost": cost, "groups": groups,
    }


def summarize(results: list[dict]) -> dict:
    summaries = []
    metrics = ("documents", "truth_origins", "support_groups", "signed_count_error", "double_count_excess", "collapse_excess", "merged_independent_pairs", "missing_lineage_documents")
    for scenario, method in sorted({(result["scenario"], result["method"]) for result in results}):
        selected = [result for result in results if (result["scenario"], result["method"]) == (scenario, method)]
        aggregate = {}
        for metric in metrics:
            values = [result[metric] for result in selected]
            aggregate[metric] = {"sum": sum(values), "n": len(values), "mean": sum(values) / len(values), "min": min(values), "max": max(values)}
        summaries.append({"scenario": scenario, "method": method, "metrics": aggregate})
    return {"schema": 1, "protocol_sha256": FROZEN_PROTOCOL_SHA256, "result_rows": len(results), "groups": summaries}


def core_artifacts() -> dict[str, bytes]:
    protocol = load_protocol()
    cases = [generate_case(protocol, seed, scenario) for seed in sorted(protocol["seeds"]) for scenario in sorted(protocol["scenarios"], key=lambda item: item["id"])]
    results = [evaluate(case, method) for case in cases for method in sorted(protocol["methods"])]
    return {
        "datasets.jsonl": b"".join(canonical(case) for case in cases),
        "results.jsonl": b"".join(canonical(result) for result in results),
        "summary.json": canonical(summarize(results)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New output directory; never overwrite a finalized run")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists; use a new path to preserve finalized artifacts")
    started = datetime.now(timezone.utc).isoformat()
    wall_start, cpu_start = time.perf_counter(), time.process_time()
    artifacts = core_artifacts()
    elapsed_wall, elapsed_cpu = time.perf_counter() - wall_start, time.process_time() - cpu_start
    args.output.mkdir(parents=True)
    for name, payload in sorted(artifacts.items()):
        (args.output / name).write_bytes(payload)
    receipt = {
        "status": "completed", "started_at_utc": started,
        "finished_at_utc": datetime.now(timezone.utc).isoformat(),
        "base_commit": load_protocol()["base_commit"],
        "artifact_head": "not_yet_committed; authoritative tree is identified by content hashes and the enclosing published research commit",
        "environment": {"python": sys.version, "implementation": platform.python_implementation(), "platform": platform.platform(), "third_party_dependencies": [], "dependency_lock": "Python standard library only; no package lock required"},
        "measured_core_generation": {"wall_seconds": elapsed_wall, "cpu_seconds": elapsed_cpu},
        "cost": {"paid_api_calls": 0, "network_requests": 0, "currency_spend": 0, "currency": "EUR", "compute_accounting": "Local process CPU time above; no cloud billing query or infrastructure-cost estimate"},
        "inputs": {"protocol.json": FROZEN_PROTOCOL_SHA256, "run.py": sha256(Path(__file__).read_bytes()), "test_replay.py": sha256((ROOT / "test_replay.py").read_bytes())},
        "outputs": {name: {"sha256": sha256(payload), "bytes": len(payload)} for name, payload in sorted(artifacts.items())},
        "command": "python3 research/gpt-20261002/g1/run.py --output research/gpt-20261002/g1/raw",
        "sources": [{"repository_path": "docs/PARALLEL_RESEARCH_GPT.md", "base_commit": load_protocol()["base_commit"], "meaning": "G1 research proposal; no external observational dataset"}],
        "chronology_limit": load_protocol()["chronology_limit"],
    }
    (args.output / "receipt.json").write_bytes(canonical(receipt))
    print(json.dumps({"status": "completed", "output": str(args.output), "rows": json.loads(artifacts["summary.json"])["result_rows"], "core_hashes": receipt["outputs"]}, sort_keys=True))


if __name__ == "__main__":
    main()

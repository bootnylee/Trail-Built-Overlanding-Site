#!/usr/bin/env python3
"""Credential-free regression test for account-level Amazon validation skip."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import validate_asin_mappings
import validate_asins


def main() -> None:
    original_report_path = validate_asins.PRICE_SYNC_REPORT
    original_verify_asin = validate_asins.verify_asin
    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            report_path = Path(tmp_dir) / "price-sync-report.json"
            report_path.write_text(
                json.dumps(
                    {
                        "mode": "account-ineligible",
                        "accountEligibility": {
                            "status": "ineligible",
                            "reason": "AssociateNotEligible",
                            "skipDownstreamAsinLookups": True,
                        },
                    }
                ),
                encoding="utf-8",
            )
            validate_asins.PRICE_SYNC_REPORT = report_path
            assert validate_asins.account_is_ineligible()

            calls: list[str] = []

            def unexpected_lookup(asin: str, expected_name: str):
                calls.append(asin)
                raise AssertionError("downstream live ASIN lookup must not run")

            validate_asins.verify_asin = unexpected_lookup
            records = [
                {
                    "file": "articles/example.html",
                    "product": "Example Product",
                    "destination_type": "asin",
                    "asin": "B000000000",
                    "url": "https://www.amazon.com/dp/B000000000",
                    "context": "product-card",
                }
            ]
            result = validate_asins.validate_records(
                records,
                static_only=False,
                remote_lookups_disabled=validate_asins.account_is_ineligible(),
            )
            assert calls == []
            assert result["products"][0]["status"] == "UNVERIFIED"
            assert "account-level Creators API ineligibility" in result["products"][0]["issue"]

            primary_report = Path(tmp_dir) / "asin_validation_report.json"
            primary_report.write_text(
                json.dumps(
                    {
                        "remote_validation": {
                            "status": "skipped",
                            "reason": "AssociateNotEligible",
                        }
                    }
                ),
                encoding="utf-8",
            )
            assert validate_asin_mappings.primary_report_confirms_account_ineligibility(primary_report)
    finally:
        validate_asins.PRICE_SYNC_REPORT = original_report_path
        validate_asins.verify_asin = original_verify_asin

    print("Downstream ASIN validation eligibility short-circuit test passed.")


if __name__ == "__main__":
    main()

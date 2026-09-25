import json

from investiq.build_static import build_site, report_filename
from investiq.data.provider import DemoProvider


def test_build_site(tmp_path):
    out = tmp_path / "site"
    index = build_site(DemoProvider(end="2026-09-24"), ["RELIANCE.NS", "M&M.NS", "AAPL"], out)
    assert [s["symbol"] for s in index["stocks"]] == ["M&M.NS", "RELIANCE.NS", "AAPL"]
    assert (out / "index.html").exists()
    assert "static: true" in (out / "static" / "config.js").read_text()
    assert not (out / "static" / "index.html").exists()
    report = json.loads((out / "data" / "reports" / f"{report_filename('M&M.NS')}.json").read_text())
    assert report["symbol"] == "M&M.NS"
    assert report_filename("M&M.NS") == "M_M.NS"
    saved = json.loads((out / "data" / "index.json").read_text())
    assert saved["demo"] is True and len(saved["stocks"]) == 3

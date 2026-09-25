import pytest
from fastapi.testclient import TestClient

from investiq.api import app
from investiq.data.provider import DataUnavailableError, DemoProvider, set_provider


@pytest.fixture(scope="module")
def client():
    set_provider(DemoProvider(end="2026-09-24"))
    return TestClient(app)


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["demo"] is True


def test_search(client):
    results = client.get("/api/search", params={"q": "reli"}).json()["results"]
    assert results[0]["symbol"] == "RELIANCE.NS"


def test_report(client):
    res = client.get("/api/report/TCS")
    assert res.status_code == 200
    assert res.json()["symbol"] == "TCS.NS"


def test_report_not_found(client, monkeypatch):
    def boom(*a, **k):
        raise DataUnavailableError("nope")

    monkeypatch.setattr(DemoProvider, "get_stock", boom)
    assert client.get("/api/report/XYZ").status_code == 404


def test_compare_validates_count(client):
    assert client.get("/api/compare", params={"symbols": "TCS"}).status_code == 400
    res = client.get("/api/compare", params={"symbols": "TCS,INFY"})
    assert res.status_code == 200 and len(res.json()["stocks"]) == 2


def test_index_page(client):
    res = client.get("/")
    assert res.status_code == 200 and "InvestIQ" in res.text

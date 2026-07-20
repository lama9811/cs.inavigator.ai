"""Idle-sweep auth guard + user memory endpoints require auth."""
from fastapi.testclient import TestClient
import main

# TrustedHostMiddleware rejects TestClient's default "testserver" host; use an allowed one.
client = TestClient(main.app, base_url="http://localhost")


def test_idle_sweep_requires_secret():
    r = client.post("/api/internal/memory/idle-sweep")
    assert r.status_code == 403


def test_idle_sweep_wrong_secret(monkeypatch):
    monkeypatch.setenv("RESEARCH_SECRET", "right")
    r = client.post("/api/internal/memory/idle-sweep", headers={"X-Research-Secret": "wrong"})
    assert r.status_code == 403


def test_get_my_memories_requires_auth():
    r = client.get("/api/me/memories")
    assert r.status_code in (401, 403)


def test_delete_all_my_memories_requires_auth():
    r = client.delete("/api/me/memories")
    assert r.status_code in (401, 403)

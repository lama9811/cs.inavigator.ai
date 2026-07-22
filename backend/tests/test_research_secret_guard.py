"""The /api/internal/* cron guard.

Regression test for a bug that silently disabled every scheduled job:

Secret Manager stores a secret payload verbatim, and RESEARCH_SECRET was created
with a trailing newline. Cloud Run mounts that newline into the environment
variable. An HTTP header cannot carry a trailing newline, so the original exact
`secret != expected` comparison could never match any real request -- every cron
endpoint returned 403 for the entire life of the deployment. Deadline reminder
emails and the planner's live-seat refresh were dead on arrival, regardless of
whether Cloud Scheduler was enabled.
"""
import hmac
import pytest
from fastapi import HTTPException

import main


class _Req:
    """Minimal stand-in for starlette's Request (only .headers is touched)."""
    def __init__(self, header=None):
        self.headers = {} if header is None else {"X-Research-Secret": header}


SECRET = "s3cr3t-value-for-tests"


def test_clean_secret_matches(monkeypatch):
    monkeypatch.setenv("RESEARCH_SECRET", SECRET)
    main._require_research_secret(_Req(SECRET))  # must not raise


def test_env_with_trailing_newline_still_matches(monkeypatch):
    """THE BUG. Cloud Run mounts the secret payload including its trailing
    newline; the caller cannot send one in a header."""
    monkeypatch.setenv("RESEARCH_SECRET", SECRET + "\n")
    main._require_research_secret(_Req(SECRET))  # must not raise


def test_env_with_surrounding_whitespace_matches(monkeypatch):
    monkeypatch.setenv("RESEARCH_SECRET", f"  {SECRET}\r\n")
    main._require_research_secret(_Req(SECRET))


def test_header_with_whitespace_matches(monkeypatch):
    monkeypatch.setenv("RESEARCH_SECRET", SECRET)
    main._require_research_secret(_Req(f" {SECRET} "))


# --- it must still actually reject ---------------------------------------

def test_wrong_secret_rejected(monkeypatch):
    monkeypatch.setenv("RESEARCH_SECRET", SECRET)
    with pytest.raises(HTTPException) as e:
        main._require_research_secret(_Req("not-the-secret"))
    assert e.value.status_code == 403


def test_missing_header_rejected(monkeypatch):
    monkeypatch.setenv("RESEARCH_SECRET", SECRET)
    with pytest.raises(HTTPException) as e:
        main._require_research_secret(_Req())
    assert e.value.status_code == 403


def test_unset_env_fails_closed(monkeypatch):
    """No configured secret must reject everything, never allow everything."""
    monkeypatch.setenv("RESEARCH_SECRET", "")
    for req in (_Req(), _Req(""), _Req(SECRET)):
        with pytest.raises(HTTPException) as e:
            main._require_research_secret(req)
        assert e.value.status_code == 403


def test_whitespace_only_env_fails_closed(monkeypatch):
    """A secret of only whitespace strips to empty and must not authorise a
    caller who also sends whitespace."""
    monkeypatch.setenv("RESEARCH_SECRET", "   \n")
    with pytest.raises(HTTPException):
        main._require_research_secret(_Req("   "))


def test_comparison_is_constant_time(monkeypatch):
    """Guard against someone 'simplifying' compare_digest back to ==."""
    import inspect
    assert "compare_digest" in inspect.getsource(main._require_research_secret)

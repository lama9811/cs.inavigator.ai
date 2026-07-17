"""Tests for the Advising Form endpoints (draft, upload, download, delete).

The suite has no TestClient/conftest fixtures, so — matching the house style of
calling endpoint logic directly — these drive the async endpoint functions with a
real in-memory SQLite session and a plain `user` dict. That exercises the actual
DB queries (auth filtering, upsert, per-user caps) without standing up the full
app lifecycle.

The two properties that matter most and are easiest to regress:
  1. Tenant isolation: a student must never read/delete another student's file.
  2. Download safety: the served MIME comes from the extension + nosniff is set,
     never the user-supplied content_type (stored-XSS guard).
"""

import asyncio
import os

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-not-for-production")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base
import models  # noqa: F401 - registers the ORM models on Base
import main
from fastapi import HTTPException


# --- in-memory DB + helpers --------------------------------------------------

@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def _user(uid=1):
    return {"user_id": uid, "email": f"student{uid}@morgan.edu", "role": "student"}


def _run(coro):
    return asyncio.run(coro)


class _FakeUpload:
    """Minimal stand-in for Starlette's UploadFile: filename, content_type, and an
    async chunked read()."""
    def __init__(self, filename, data=b"%PDF-1.4 hello", content_type="application/pdf"):
        self.filename = filename
        self.content_type = content_type
        self._data = data
        self._pos = 0

    async def read(self, size=-1):
        if self._pos >= len(self._data):
            return b""
        chunk = self._data[self._pos:self._pos + size] if size and size > 0 else self._data[self._pos:]
        self._pos += len(chunk)
        return chunk


def _upload(db, user, filename, data=b"%PDF-1.4 hello", content_type="application/pdf"):
    return _run(main.upload_advising_document(
        file=_FakeUpload(filename, data, content_type), user=user, db=db,
    ))


# --- draft -------------------------------------------------------------------

def test_draft_empty_when_none_saved(db):
    res = _run(main.get_advising_draft(user=_user(), db=db))
    assert res == {"forms": {}, "submitted": False}


def test_draft_saves_and_round_trips(db):
    _run(main.save_advising_draft({"forms": {"f1": {"name": "Ada"}}}, user=_user(), db=db))
    res = _run(main.get_advising_draft(user=_user(), db=db))
    assert res["forms"] == {"f1": {"name": "Ada"}}
    assert res["submitted"] is False


def test_draft_upserts_one_row_per_user(db):
    u = _user()
    _run(main.save_advising_draft({"forms": {"f1": {"a": "1"}}}, user=u, db=db))
    _run(main.save_advising_draft({"forms": {"f1": {"a": "2"}}}, user=u, db=db))
    rows = db.query(models.AdvisingFormDraft).filter(
        models.AdvisingFormDraft.user_id == u["user_id"]
    ).all()
    assert len(rows) == 1                                  # updated, not duplicated
    assert _run(main.get_advising_draft(user=u, db=db))["forms"] == {"f1": {"a": "2"}}


def test_draft_rejects_non_dict_forms(db):
    with pytest.raises(HTTPException) as e:
        _run(main.save_advising_draft({"forms": "nope"}, user=_user(), db=db))
    assert e.value.status_code == 400


def test_draft_rejects_oversized_payload(db):
    big = {"f1": {"x": "a" * 200_000}}
    with pytest.raises(HTTPException) as e:
        _run(main.save_advising_draft({"forms": big}, user=_user(), db=db))
    assert e.value.status_code == 413


def test_draft_submitted_flag_persists(db):
    u = _user()
    _run(main.save_advising_draft({"forms": {"f1": {}}, "submitted": True}, user=u, db=db))
    assert _run(main.get_advising_draft(user=u, db=db))["submitted"] is True


def test_draft_is_per_user(db):
    _run(main.save_advising_draft({"forms": {"f1": {"a": "mine"}}}, user=_user(1), db=db))
    other = _run(main.get_advising_draft(user=_user(2), db=db))
    assert other == {"forms": {}, "submitted": False}      # user 2 sees nothing of user 1's


# --- upload ------------------------------------------------------------------

def test_upload_accepts_pdf_and_returns_id(db):
    res = _upload(db, _user(), "sequence.pdf")
    assert "id" in res["stored_name"] or res["stored_name"].isdigit()
    assert res["filename"] == "sequence.pdf"


def test_upload_rejects_disallowed_extension(db):
    with pytest.raises(HTTPException) as e:
        _upload(db, _user(), "malware.exe", data=b"MZ...", content_type="application/octet-stream")
    assert e.value.status_code == 400


def test_upload_rejects_empty_file(db):
    with pytest.raises(HTTPException) as e:
        _upload(db, _user(), "empty.pdf", data=b"")
    assert e.value.status_code == 400


def test_upload_sanitizes_filename(db):
    res = _upload(db, _user(), 'we"ird/../name.pdf')
    assert '"' not in res["filename"] and "/" not in res["filename"]


def test_upload_enforces_per_user_count_cap(db, monkeypatch):
    monkeypatch.setattr(main, "ADVISING_MAX_UPLOADS_PER_USER", 3)
    u = _user()
    for i in range(3):
        _upload(db, u, f"f{i}.pdf")
    with pytest.raises(HTTPException) as e:
        _upload(db, u, "over.pdf")
    assert e.value.status_code == 413


def test_upload_enforces_per_user_byte_cap(db, monkeypatch):
    monkeypatch.setattr(main, "ADVISING_MAX_TOTAL_BYTES_PER_USER", 100)
    with pytest.raises(HTTPException) as e:
        _upload(db, _user(), "big.pdf", data=b"x" * 200)
    assert e.value.status_code == 413


# --- download (safe MIME + nosniff + owner-only) -----------------------------

def test_download_uses_safe_mime_not_uploaded_content_type(db):
    # Upload HTML bytes with a spoofed content_type, named .pdf.
    res = _upload(db, _user(), "evil.pdf",
                  data=b"<script>alert(1)</script>", content_type="text/html")
    upload_id = int(res["stored_name"])
    resp = _run(main.get_advising_document(upload_id=upload_id, user=_user(), db=db))
    assert resp.media_type == "application/pdf"            # from the extension, NOT text/html
    assert resp.headers.get("x-content-type-options") == "nosniff"


def test_download_owner_only(db):
    res = _upload(db, _user(1), "mine.pdf")
    upload_id = int(res["stored_name"])
    with pytest.raises(HTTPException) as e:
        _run(main.get_advising_document(upload_id=upload_id, user=_user(2), db=db))
    assert e.value.status_code == 404                      # 404, not 403 — no existence leak


def test_download_unknown_id_404(db):
    with pytest.raises(HTTPException) as e:
        _run(main.get_advising_document(upload_id=99999, user=_user(), db=db))
    assert e.value.status_code == 404


# --- delete (owner-only, idempotent, real removal) ---------------------------

def test_delete_removes_the_blob(db):
    res = _upload(db, _user(), "gone.pdf")
    upload_id = int(res["stored_name"])
    _run(main.delete_advising_document(upload_id=upload_id, user=_user(), db=db))
    # The row is gone -> a subsequent download 404s.
    with pytest.raises(HTTPException) as e:
        _run(main.get_advising_document(upload_id=upload_id, user=_user(), db=db))
    assert e.value.status_code == 404


def test_delete_is_owner_only(db):
    res = _upload(db, _user(1), "mine.pdf")
    upload_id = int(res["stored_name"])
    _run(main.delete_advising_document(upload_id=upload_id, user=_user(2), db=db))  # no-op for user 2
    # User 1's file is still there.
    resp = _run(main.get_advising_document(upload_id=upload_id, user=_user(1), db=db))
    assert resp.media_type == "application/pdf"


def test_delete_unknown_id_is_idempotent(db):
    res = _run(main.delete_advising_document(upload_id=12345, user=_user(), db=db))
    assert res["ok"] is True

import os
from datetime import datetime, timezone
from types import SimpleNamespace

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-not-for-production")

from main import _admin_user_row


def _user(**overrides):
    base = dict(
        id=1,
        email="student@morgan.edu",
        name="Student",
        role="student",
        student_id="M001",
        major="Computer Science",
        morgan_connected=False,
        is_disabled=False,
        disabled_at=None,
        disabled_reason=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        email_verified=True,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_admin_user_row_reports_verified_state():
    assert _admin_user_row(_user(email_verified=True))["email_verified"] is True
    assert _admin_user_row(_user(email_verified=False))["email_verified"] is False


def test_admin_user_row_treats_null_verified_as_unverified():
    """Legacy rows predating the column read as NULL. They have not verified, so
    they must not be reported as verified — the admin count drives the decision to
    switch the login gate on, and over-reporting would hide locked-out users."""
    assert _admin_user_row(_user(email_verified=None))["email_verified"] is False


def test_admin_user_row_keeps_existing_fields():
    row = _admin_user_row(_user())
    for field in (
        "id", "email", "name", "role", "student_id", "major",
        "morgan_connected", "is_disabled", "disabled_at",
        "disabled_reason", "created_at",
    ):
        assert field in row, f"{field} disappeared from the admin user row"
    assert row["created_at"] == "2026-01-01T00:00:00+00:00"

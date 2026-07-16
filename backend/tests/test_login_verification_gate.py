import os
from types import SimpleNamespace

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-not-for-production")

from routers.auth import _needs_email_verification


def _user(**overrides):
    base = dict(role="student", email_verified=True)
    base.update(overrides)
    return SimpleNamespace(**base)


def test_verified_student_may_log_in():
    assert _needs_email_verification(_user(email_verified=True)) is False


def test_unverified_student_is_blocked():
    assert _needs_email_verification(_user(email_verified=False)) is True


def test_legacy_null_verified_is_blocked():
    """Rows predating the column store NULL. They have not verified, so they must be
    blocked — treating NULL as verified would silently let unverified users through
    the gate we just switched on."""
    assert _needs_email_verification(_user(email_verified=None)) is True


def test_admin_is_never_locked_out():
    """The admin escape hatch. If a bad deploy or a broken sender leaves every student
    unable to verify, an admin must still be able to log in and turn the gate back off."""
    assert _needs_email_verification(_user(role="admin", email_verified=False)) is False
    assert _needs_email_verification(_user(role="admin", email_verified=None)) is False

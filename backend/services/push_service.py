"""
Web Push (VAPID) delivery
=========================
Sends browser push notifications to a user's subscribed devices. Used as a
second delivery channel for deadline reminders (alongside email) and for the
"send test notification" button.

Config comes from env (see backend/.env locally, Secret Manager in prod):
  - VAPID_PUBLIC_KEY        base64url applicationServerKey (also handed to the browser)
  - VAPID_PRIVATE_KEY_B64   PKCS8 PEM private key, base64-encoded (single line)
  - VAPID_SUBJECT           a mailto: or https: contact URI (required by the spec)

If the keys are absent, `is_push_configured()` returns False and the app runs
email-only — push simply degrades, it never breaks anything.
"""

import base64
import json
import os

_VAPID = None          # cached py_vapid Vapid02 instance
_VAPID_LOADED = False   # so we only attempt to build it once


def _public_key() -> str:
    return (os.getenv("VAPID_PUBLIC_KEY") or "").strip()


def _subject() -> str:
    return (os.getenv("VAPID_SUBJECT") or "mailto:admin@example.com").strip()


def _load_vapid():
    """Build (and cache) the py_vapid signer from the base64 PEM env var."""
    global _VAPID, _VAPID_LOADED
    if _VAPID_LOADED:
        return _VAPID
    _VAPID_LOADED = True
    pem_b64 = os.getenv("VAPID_PRIVATE_KEY_B64")
    if not pem_b64 or not _public_key():
        return None
    try:
        from py_vapid import Vapid02
        pem = base64.b64decode(pem_b64)
        _VAPID = Vapid02.from_pem(pem)
    except Exception as e:  # malformed key -> treat as not configured
        print(f"[PUSH] Failed to load VAPID key: {e}")
        _VAPID = None
    return _VAPID


def is_push_configured() -> bool:
    """True when VAPID keys are present and loadable."""
    return _load_vapid() is not None


def get_public_key() -> str:
    """The browser applicationServerKey (base64url). Empty string if unconfigured."""
    return _public_key() if is_push_configured() else ""


def send_web_push(subscription: dict, payload: dict) -> str:
    """Send one push. Returns 'ok', 'expired' (caller should delete the row),
    or 'error'. `subscription` is {endpoint, keys:{p256dh, auth}}."""
    vapid = _load_vapid()
    if vapid is None:
        return "error"
    try:
        from pywebpush import webpush, WebPushException
    except Exception as e:
        print(f"[PUSH] pywebpush not installed: {e}")
        return "error"

    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=vapid,
            # Fresh dict every call: pywebpush mutates it (adds aud/exp).
            vapid_claims={"sub": _subject()},
            ttl=86400,
        )
        return "ok"
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status in (404, 410):
            # Subscription no longer valid — the caller should prune it.
            return "expired"
        print(f"[PUSH] WebPushException (status={status}): {e}")
        return "error"
    except Exception as e:
        print(f"[PUSH] send failed: {e}")
        return "error"


def build_subscription(row) -> dict:
    """Convert a PushSubscription DB row into the dict pywebpush expects."""
    return {
        "endpoint": row.endpoint,
        "keys": {"p256dh": row.p256dh, "auth": row.auth},
    }

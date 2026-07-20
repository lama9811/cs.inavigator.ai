"""
Email Service for CS Navigator
================================
Sends verification and password reset emails.
Uses Gmail SMTP or any SMTP provider.
"""

import os
import smtplib
import secrets
import logging
from html import escape as _html_escape
from urllib.parse import urlparse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

log = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USER or "csnav@morgan.edu")
APP_URL = os.getenv("APP_URL", "https://cs.inavigator.ai")
API_URL = os.getenv("API_URL", "https://csnavigator-backend-900141432581.us-central1.run.app")


def generate_token() -> str:
    """Generate a secure random token."""
    return secrets.token_urlsafe(32)


def is_email_configured() -> bool:
    """Return whether SMTP is configured for real email delivery."""
    return bool(SMTP_USER and SMTP_PASS)


def build_verification_url(token: str) -> str:
    return f"{API_URL}/api/verify-email?token={token}"


def _send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Send an email via SMTP. Returns True on success."""
    if not is_email_configured():
        # Never log message bodies: verification and reset URLs contain bearer
        # tokens that must not appear in local or Cloud Run logs.
        log.warning("[EMAIL] SMTP not configured; email delivery was skipped (%s).", subject)
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"CS Navigator <{FROM_EMAIL}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(FROM_EMAIL, to_email, msg.as_string())

        log.info(f"[EMAIL] Sent to {to_email}: {subject}")
        return True
    except Exception as e:
        log.error(f"[EMAIL] Failed to send to {to_email}: {e}")
        return False


def send_verification_email(to_email: str, token: str) -> bool:
    """Send email verification link."""
    verify_url = build_verification_url(token)
    html = f"""
    <div style="font-family: 'Google Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #4285F4; font-size: 24px; margin: 0;">CS Navigator</h1>
            <p style="color: #5f6368; font-size: 14px;">Morgan State University</p>
        </div>
        <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; border: 1px solid #dadce0;">
            <h2 style="color: #202124; font-size: 18px; margin: 0 0 12px;">Verify your email</h2>
            <p style="color: #5f6368; font-size: 14px; line-height: 1.6;">
                Click the button below to verify your Morgan State email and activate your account.
            </p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{verify_url}" style="display: inline-block; padding: 12px 32px; background: #4285F4; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
                    Verify Email
                </a>
            </div>
            <p style="color: #9aa0a6; font-size: 12px; text-align: center;">
                Or copy this link: {verify_url}
            </p>
        </div>
        <p style="color: #9aa0a6; font-size: 11px; text-align: center; margin-top: 16px;">
            If you didn't create an account, ignore this email.
        </p>
    </div>
    """
    return _send_email(to_email, "Verify your CS Navigator account", html)


def _format_due(due_at: str) -> str:
    """Best-effort human-friendly due time; falls back to the raw string."""
    if not due_at or not isinstance(due_at, str):
        return "soon"
    raw = due_at.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        from datetime import datetime
        return datetime.fromisoformat(raw).strftime("%a, %b %-d at %-I:%M %p UTC")
    except (ValueError, TypeError):
        return due_at


def _safe_http_url(url) -> str | None:
    """Return `url` only if it's a syntactically valid http(s) URL, else None.

    Blocks `javascript:`, `data:`, and other schemes that could turn an email
    link into an injection vector."""
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url.strip())
    except (ValueError, TypeError):
        return None
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return url.strip()
    return None


def send_deadline_reminder_email(to_email: str, assignment: dict) -> bool:
    """Email a student ~24h before a Canvas assignment in an opted-in class is due.

    `assignment` is one item from CanvasStudentData.upcoming_assignments:
    {title, course_name, due_at, url, ...}. These values originate from Canvas
    (instructor-controlled), so every interpolated value is HTML-escaped and the
    link is scheme-validated before it reaches the outbound email."""
    # Raw, untrusted values.
    raw_title = assignment.get("title") or "An assignment"
    raw_course = assignment.get("course_name") or "your class"

    # Escaped for safe interpolation into HTML text / attribute contexts.
    title = _html_escape(str(raw_title))
    course = _html_escape(str(raw_course))
    due = _html_escape(_format_due(assignment.get("due_at")))
    classes_url = _html_escape(f"{APP_URL}/my-classes", quote=True)

    safe_url = _safe_http_url(assignment.get("url"))
    open_btn = ""
    if safe_url:
        href = _html_escape(safe_url, quote=True)
        open_btn = f"""
            <div style="text-align: center; margin: 24px 0;">
                <a href="{href}" style="display: inline-block; padding: 12px 32px; background: #4285F4; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
                    Open in Canvas
                </a>
            </div>"""

    html = f"""
    <div style="font-family: 'Google Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #4285F4; font-size: 24px; margin: 0;">CS Navigator</h1>
            <p style="color: #5f6368; font-size: 14px;">Deadline reminder</p>
        </div>
        <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; border: 1px solid #dadce0;">
            <h2 style="color: #202124; font-size: 18px; margin: 0 0 12px;">Due in about 24 hours</h2>
            <p style="color: #202124; font-size: 15px; line-height: 1.6; margin: 0 0 4px;">
                <strong>{title}</strong>
            </p>
            <p style="color: #5f6368; font-size: 14px; line-height: 1.6; margin: 0;">
                {course} &middot; due {due}
            </p>
            {open_btn}
            <p style="color: #9aa0a6; font-size: 12px; line-height: 1.5; margin: 16px 0 0;">
                Based on your last Canvas sync &mdash; if your professor changed the
                deadline, <a href="{classes_url}" style="color: #4285F4;">re-sync</a> to stay accurate.
            </p>
        </div>
        <p style="color: #9aa0a6; font-size: 11px; text-align: center; margin-top: 16px;">
            You're getting this because you turned on reminders for this class.
            Manage them on your <a href="{classes_url}" style="color: #9aa0a6;">My Classes</a> page.
        </p>
    </div>
    """
    # Subject is a header: collapse whitespace/newlines to prevent header injection.
    subject_title = " ".join(str(raw_title).split())[:120] or "An assignment"
    return _send_email(to_email, f"Reminder: {subject_title} is due soon", html)


def send_scholarship_deadline_email(to_email: str, item: dict, days_remaining: int) -> bool:
    """Email a student when a saved scholarship / internship deadline is near.

    `item` is a saved-opportunity dict {name, kind, deadline, award, url, ...}.
    The name and award originate from web search / the source page (untrusted),
    so every interpolated value is HTML-escaped and the apply link is
    scheme-validated before it reaches the outbound email — same discipline as
    the Canvas reminder above."""
    raw_name = item.get("name") or "A saved opportunity"
    kind = str(item.get("kind") or "scholarship").strip().lower()
    noun = "internship" if kind == "internship" else "scholarship"

    name = _html_escape(str(raw_name))
    deadline = _html_escape(str(item.get("deadline") or "soon"))
    award = _html_escape(str(item.get("award") or item.get("pay") or ""))
    saved_url = _html_escape(f"{APP_URL}/scholarships", quote=True)

    # "in 1 day" reads better than "in 1 days".
    when = "tomorrow" if days_remaining == 1 else f"in {days_remaining} days"

    award_line = ""
    if award:
        award_line = f"""
            <p style="color: #5f6368; font-size: 14px; line-height: 1.6; margin: 4px 0 0;">
                {award}
            </p>"""

    safe_url = _safe_http_url(item.get("url"))
    open_btn = ""
    if safe_url:
        href = _html_escape(safe_url, quote=True)
        open_btn = f"""
            <div style="text-align: center; margin: 24px 0;">
                <a href="{href}" style="display: inline-block; padding: 12px 32px; background: #34A853; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
                    Open the application
                </a>
            </div>"""

    html = f"""
    <div style="font-family: 'Google Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #4285F4; font-size: 24px; margin: 0;">CS Navigator</h1>
            <p style="color: #5f6368; font-size: 14px;">{noun.capitalize()} deadline</p>
        </div>
        <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; border: 1px solid #dadce0;">
            <h2 style="color: #202124; font-size: 18px; margin: 0 0 12px;">Deadline {when}</h2>
            <p style="color: #202124; font-size: 15px; line-height: 1.6; margin: 0 0 4px;">
                <strong>{name}</strong>
            </p>
            <p style="color: #5f6368; font-size: 14px; line-height: 1.6; margin: 0;">
                Due {deadline}
            </p>
            {award_line}
            {open_btn}
            <p style="color: #9aa0a6; font-size: 12px; line-height: 1.5; margin: 16px 0 0;">
                You saved this in CS Navigator. Check your
                <a href="{saved_url}" style="color: #4285F4;">My Scholarships</a> list to
                finish the checklist before the deadline.
            </p>
        </div>
        <p style="color: #9aa0a6; font-size: 11px; text-align: center; margin-top: 16px;">
            You're getting this because you saved this {noun}. Remove it from your
            <a href="{saved_url}" style="color: #9aa0a6;">My Scholarships</a> list to stop reminders.
        </p>
    </div>
    """
    # Subject is a header: collapse whitespace/newlines to prevent header injection.
    subject_name = " ".join(str(raw_name).split())[:120] or "A saved opportunity"
    return _send_email(to_email, f"Deadline {when}: {subject_name}", html)


def send_password_reset_email(to_email: str, token: str) -> bool:
    """Send password reset link."""
    reset_url = f"{APP_URL}/reset-password?token={token}"
    html = f"""
    <div style="font-family: 'Google Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #4285F4; font-size: 24px; margin: 0;">CS Navigator</h1>
            <p style="color: #5f6368; font-size: 14px;">Morgan State University</p>
        </div>
        <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; border: 1px solid #dadce0;">
            <h2 style="color: #202124; font-size: 18px; margin: 0 0 12px;">Reset your password</h2>
            <p style="color: #5f6368; font-size: 14px; line-height: 1.6;">
                Click the button below to reset your password. This link expires in 1 hour.
            </p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{reset_url}" style="display: inline-block; padding: 12px 32px; background: #4285F4; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
                    Reset Password
                </a>
            </div>
            <p style="color: #9aa0a6; font-size: 12px; text-align: center;">
                Or copy this link: {reset_url}
            </p>
        </div>
        <p style="color: #9aa0a6; font-size: 11px; text-align: center; margin-top: 16px;">
            If you didn't request a password reset, ignore this email.
        </p>
    </div>
    """
    return _send_email(to_email, "Reset your CS Navigator password", html)

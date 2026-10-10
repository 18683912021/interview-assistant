"""SMTP transport is mocked; these tests never send email."""
import ssl
import threading

import pytest

from app.services import email_service


@pytest.mark.asyncio
@pytest.mark.parametrize("port", [465, 587])
async def test_smtp_runs_outside_event_loop_and_validates_tls(monkeypatch, port):
    monkeypatch.setattr(email_service, "_SMTP_HOST", "smtp.example.test")
    monkeypatch.setattr(email_service, "_SMTP_PORT", port)
    monkeypatch.setattr(email_service, "_SMTP_USER", "sender@example.test")
    monkeypatch.setattr(email_service, "_SMTP_PASSWORD", "mock-secret")
    main_thread = threading.get_ident()
    calls = []
    class SMTP:
        def __init__(self, host, port, timeout, context=None):
            assert threading.get_ident() != main_thread
            calls.append(("connect", context))
        def __enter__(self):
            return self
        def __exit__(self, *_):
            pass
        def ehlo(self):
            calls.append(("ehlo", None))
        def starttls(self, context):
            calls.append(("starttls", context))
        def login(self, user, password):
            calls.append(("auth", None))
        def send_message(self, message):
            calls.append(("send", message))
    monkeypatch.setattr(email_service.smtplib, "SMTP_SSL", SMTP)
    monkeypatch.setattr(email_service.smtplib, "SMTP", SMTP)
    await email_service.send_code_email("recipient@example.test", "123456", "reset_password")
    context = next(value for name, value in calls if name == ("connect" if port == 465 else "starttls"))
    assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED
    names = [name for name, _ in calls]
    assert names.index("auth") < names.index("send")
    if port == 587:
        assert names == ["connect", "ehlo", "starttls", "ehlo", "auth", "send"]
    message = next(value for name, value in calls if name == "send")
    assert "重置密码" in str(message["Subject"])
    plain = message.get_payload()[0].get_payload(decode=True).decode()
    assert "重置密码" in plain


def test_purpose_specific_email_and_invalid_port_are_explicit(monkeypatch):
    for purpose, action in (("login", "登录账号"), ("register", "注册账号"), ("reset_password", "重置密码")):
        message = email_service._build_email("recipient@example.test", "123456", purpose)
        assert action in str(message["Subject"])
    monkeypatch.setattr(email_service, "_SMTP_PORT", 0)
    assert email_service.get_smtp_config()["configured"] is False

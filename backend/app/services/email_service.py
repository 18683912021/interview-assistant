"""邮件发送服务 —— SMTP 验证码邮件。

通过 QQ邮箱 / 163 / Gmail 等 SMTP 服务器发送 6 位验证码。
配置通过环境变量注入，不写死在代码里。

环境变量:
    SMTP_HOST          SMTP 服务器地址（如 smtp.qq.com）
    SMTP_PORT          端口（465=SSL, 587=STARTTLS）
    SMTP_USER          发件邮箱地址
    SMTP_PASSWORD      邮箱授权码（不是登录密码）
    SMTP_FROM_NAME     发件人显示名称（可选，默认 "AI面试助手"）
"""

import logging
import smtplib
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

logger = logging.getLogger("email")

_SMTP_HOST = os.getenv("SMTP_HOST", "")
_SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
_SMTP_USER = os.getenv("SMTP_USER", "")
_SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
_FROM_NAME = os.getenv("SMTP_FROM_NAME", "AI面试助手")

# ── 邮件模板 ──
_EMAIL_SUBJECT = "【AI面试助手】邮箱验证码"

_EMAIL_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F7;padding:48px 0;">
<tr><td align="center">

  <!-- ── 主卡片 ── -->
  <table width="440" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(79,70,229,0.08),0 1px 3px rgba(0,0,0,0.04);">

    <!-- ── Header ── -->
    <tr>
      <td style="background:linear-gradient(135deg,#4338CA 0%,#4F46E5 40%,#6366F1 100%);padding:36px 36px 32px;text-align:center;">
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
          <tr>
            <td style="background:rgba(255,255,255,0.18);width:64px;height:64px;border-radius:32px;text-align:center;vertical-align:middle;">
              <span style="font-size:22px;line-height:64px;color:#FFFFFF;font-weight:800;letter-spacing:1px;">AI</span>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 4px;color:#FFFFFF;font-size:22px;font-weight:800;letter-spacing:2px;">AI 面试助手</p>
        <p style="margin:0;color:rgba(255,255,255,0.75);font-size:13px;font-weight:500;letter-spacing:0.5px;">实时转写 &middot; AI 辅助面试</p>
      </td>
    </tr>

    <!-- ── 装饰分隔线 ── -->
    <tr><td style="height:3px;background:#4F46E5;"></td></tr>

    <!-- ── Body ── -->
    <tr>
      <td style="padding:36px 36px 28px;">
        <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#1F2937;">你好，</p>
        <p style="margin:0 0 28px;font-size:14px;color:#6B7280;line-height:24px;">
          你正在登录 <strong style="color:#374151;">AI 面试助手</strong>。请使用以下验证码完成身份验证：
        </p>

        <!-- 验证码 -->
        <p style="margin:0 0 28px;text-align:center;font-family:'SF Mono','SFMono-Regular',Menlo,Consolas,monospace;font-size:36px;font-weight:800;color:#4338CA;letter-spacing:10px;">
          {code}
        </p>

        <!-- 提示 -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;">
          <tr>
            <td style="padding:14px 18px;text-align:center;">
              <p style="margin:0;font-size:13px;color:#92400E;line-height:20px;">
                &#9202; 验证码 <strong>5 分钟内</strong>有效，请勿转发给他人<br>
                &#128274; 如非本人操作，请忽略此邮件
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── Footer ── -->
    <tr>
      <td style="background:#FAFAFC;border-top:1px solid #EEEEF2;padding:20px 36px;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#9CA3AF;letter-spacing:1px;">AI 面试助手</p>
        <p style="margin:0;font-size:11px;color:#C4C4CD;">实时转写 &middot; 智能建议 &middot; 多语言赛道</p>
      </td>
    </tr>

  </table>

  <!-- ── 底部小字 ── -->
  <p style="margin:20px 0 0;font-size:11px;color:#C4C4CD;">此邮件由系统自动发送，请勿回复</p>

</td></tr>
</table>
</body>
</html>"""


def _code_boxes_html(code: str) -> str:
    """将 6 位验证码渲染为独立数字方块。"""
    tds = []
    for i, digit in enumerate(code):
        tds.append(
            f'<td style="width:50px;height:60px;background:#F5F3FF;'
            f'border:2px solid #DDD6FE;border-radius:12px;'
            f'text-align:center;vertical-align:middle;">'
            f'<span style="font-family:\'SF Mono\',\'SFMono-Regular\',Menlo,Consolas,monospace;'
            f'font-size:28px;font-weight:700;color:#4338CA;">'
            f'{digit}</span></td>'
        )
        if i < len(code) - 1:
            tds.append('<td style="width:10px;"></td>')
    return "".join(tds)


def _build_email(to_email: str, code: str) -> MIMEMultipart:
    """构建 HTML 验证码邮件。"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = _EMAIL_SUBJECT
    msg["From"] = formataddr((_FROM_NAME, _SMTP_USER))
    msg["To"] = to_email

    plain = f"【AI面试助手】你的验证码是：{code}，5 分钟内有效。如非本人操作，请忽略此邮件。"
    html = _EMAIL_HTML.format(code_boxes=_code_boxes_html(code))

    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    return msg


def get_smtp_config() -> dict:
    """返回当前 SMTP 配置（不含密码），供调试用。"""
    return {
        "host": _SMTP_HOST,
        "port": _SMTP_PORT,
        "user": _SMTP_USER,
        "configured": bool(_SMTP_HOST and _SMTP_USER and _SMTP_PASSWORD),
    }


async def send_code_email(to_email: str, code: str) -> None:
    """发送验证码邮件。

    Args:
        to_email: 收件人邮箱
        code: 6 位验证码

    Raises:
        RuntimeError: SMTP 未配置
        smtplib.SMTPException: 发送失败
    """
    if not _SMTP_HOST or not _SMTP_USER or not _SMTP_PASSWORD:
        raise RuntimeError("SMTP 未配置，请设置 SMTP_HOST / SMTP_USER / SMTP_PASSWORD 环境变量")

    msg = _build_email(to_email, code)

    # SSL 直连（端口 465）
    if _SMTP_PORT == 465:
        with smtplib.SMTP_SSL(_SMTP_HOST, _SMTP_PORT, timeout=15) as server:
            server.login(_SMTP_USER, _SMTP_PASSWORD)
            server.send_message(msg)
    else:
        # STARTTLS（端口 587 等）
        with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(_SMTP_USER, _SMTP_PASSWORD)
            server.send_message(msg)

    logger.info("验证码已发送至 %s", to_email)

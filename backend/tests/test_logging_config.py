"""Logging checks never load .env, record audio, or call external services."""
import logging

import pytest

from app.logging_config import configure_logging
from app.services import asr_text_corrector as corrector


@pytest.fixture(autouse=True)
def restore_log_levels():
    names = ("", "websockets", "httpcore", "httpx", "hpack", "pdfminer", "stt_streaming", "asr_corrector")
    previous = {name: logging.getLogger(name).level for name in names}
    yield
    for name, level in previous.items():
        logging.getLogger(name).setLevel(level)


@pytest.mark.parametrize("configured, expected", [(None, logging.INFO), ("", logging.INFO),
                                                  (" debug ", logging.DEBUG), ("warning", logging.WARNING),
                                                  ("invalid-value", logging.INFO)])
def test_production_level_defaults_and_explicit_diagnostics(configured, expected):
    configure_logging(configured)
    assert logging.getLogger().getEffectiveLevel() == expected
    assert logging.getLogger("stt_streaming").getEffectiveLevel() == max(expected, logging.INFO)


def test_verbose_pdf_content_is_suppressed_even_when_app_debug_is_enabled(caplog):
    configure_logging("DEBUG")
    logging.getLogger("pdfminer.pdfparser").debug("private resume canary")
    logging.getLogger("pdfminer.pdfparser").info("private PDF object canary")
    logging.getLogger("pdfminer.pdfparser").warning("PDF structure unavailable")
    logging.getLogger("main").debug("safe app diagnostic")
    assert "canary" not in caplog.text
    assert "PDF structure unavailable" in caplog.text
    assert "safe app diagnostic" in caplog.text


def test_exact_correction_never_logs_original_or_corrected_transcript(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="asr_corrector")
    monkeypatch.setattr(corrector, "_load_terms", lambda _track=None: None)
    monkeypatch.setattr(corrector, "_CORRECTIONS_BY_LEN", [(3, "误识别", "真实术语")])
    original = "私有简历 canary@example.test 使用误识别"
    corrected = corrector.correct_asr_text(original)
    assert corrected == "私有简历 canary@example.test 使用真实术语"
    assert "ASR 纠正完成" in caplog.text
    assert "canary" not in caplog.text
    assert original not in caplog.text and corrected not in caplog.text
    assert "误识别" not in caplog.text and "真实术语" not in caplog.text


def test_fuzzy_correction_keeps_text_out_of_debug_logs(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="asr_corrector")
    monkeypatch.setattr(corrector, "_get_pinyin_db", lambda: [corrector._PinyinTerm("参考术语", "same")])
    monkeypatch.setattr(corrector, "_to_pinyin", lambda _text: "same")
    assert corrector._pinyin_fuzzy_correct("机密口令") == "参考术语"
    assert "匹配度=100%" in caplog.text
    assert "机密口令" not in caplog.text and "参考术语" not in caplog.text

"""Production-safe logging defaults; no credentials or interview text belong here."""
import logging
import sys


def configure_logging(level: str | None = None) -> None:
    levels = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    selected = levels.get((level or "INFO").strip().upper(), logging.INFO)
    logging.basicConfig(
        level=selected,
        format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
        stream=sys.stderr,
    )
    # Uvicorn or a process manager may already have installed a root handler.
    # basicConfig alone would silently keep its previous log level in that case.
    logging.getLogger().setLevel(selected)
    for name in ("websockets", "httpcore", "httpx", "hpack", "pdfminer"):
        logging.getLogger(name).setLevel(logging.WARNING)
    logging.getLogger("stt_streaming").setLevel(max(selected, logging.INFO))

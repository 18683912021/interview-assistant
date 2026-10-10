"""Session media lifecycle; shares the live transport's owner/session namespace."""
import hashlib
import shutil
from uuid import UUID

from app.services.audio_service import storage_root


def delete_session_media(email: str, session_id: UUID) -> None:
    owner_directory = storage_root() / hashlib.sha256(email.encode("utf-8")).hexdigest()
    session_directory = owner_directory / str(session_id)
    if not session_directory.exists():
        return
    if session_directory.is_symlink() or session_directory.resolve().parent != owner_directory.resolve():
        raise OSError("invalid session media path")
    try:
        shutil.rmtree(session_directory)
    except FileNotFoundError:
        if session_directory.exists():
            raise

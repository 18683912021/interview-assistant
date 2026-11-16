from copy import deepcopy

from app.services import asr_text_corrector as corrector
from app.services.tracks.common import TRACK


def test_alternating_users_reuse_track_lookup_without_mutating_common_terms(monkeypatch):
    corrector._terms_for_track.cache_clear()
    monkeypatch.setattr(corrector, '_TRACK_LOADED', None)
    before = deepcopy(TRACK['terms'])
    build = corrector._build_lookup
    calls = []
    def counted(terms):
        calls.append(len(terms))
        return build(terms)
    monkeypatch.setattr(corrector, '_build_lookup', counted)
    try:
        expected = {}
        for _ in range(100):
            for track in (None, 'javascript', 'java', 'python'):
                result = corrector.correct_asr_text('测试 ASR 术语和 React 的接口', track)
                assert result == expected.setdefault(track, result)
        assert len(calls) == 4
        assert TRACK['terms'] == before
    finally:
        corrector._terms_for_track.cache_clear()

"""Opt-in paid provider check using public synthetic speech, never a microphone.

Run from backend with PYTHONPATH=. and an explicit private --env path.
Outputs timings/counts/hashes only; no credentials, URLs or transcript text.
"""
import argparse
import asyncio
import hashlib
import json
import time
import wave
from pathlib import Path


async def check(args):
    from app.services.stt_tencent import TencentASRSession
    with wave.open(args.wav) as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000)
        sample = audio.readframes(audio.getnframes())
    frames = round(args.seconds * 25)
    # Silence at each repetition exercises stop/start sentence detection too.
    clip = sample + bytes(round(args.gap_ms * 32))
    pcm = (clip * (frames * 1280 // len(clip) + 1))[:frames * 1280]
    queue = asyncio.Queue()
    sources = ('mic', 'system') if args.dual else ('mic',)
    sessions = [TencentASRSession(source, queue) for source in sources]
    stats = {source: {'bytes': 0, 'partials': 0, 'finals': 0, 'max_queue_frames': 0,
                      'max_pending_audio_ms': 0, 'errors': [], 'first_text_ms': None} for source in sources}
    digests = {source: hashlib.sha256() for source in sources}
    latest = {source: 0 for source in sources}
    worst = {source: 0 for source in sources}
    send_lags = {source: [] for source in sources}
    for session in sessions:
        original = session._send_audio
        async def send(data, final=False, session=session, original=original):
            await original(data, final)
            stats[session._source]['bytes'] += len(data)
            digests[session._source].update(data)
            if data:
                send_lags[session._source].append(max(0, (time.monotonic() - started) * 1000
                    - stats[session._source]['bytes'] / 32))
        session._send_audio = send
    await asyncio.gather(*(session.connect() for session in sessions))
    started = time.monotonic()
    async def receive():
        while True:
            event = await queue.get()
            source = event.get('source')
            if source not in stats: continue
            item = stats[source]
            if event.get('type') == 'error': item['errors'].append(event.get('code'))
            elif event.get('text'):
                elapsed = time.monotonic() - started
                if item['first_text_ms'] is None: item['first_text_ms'] = round(elapsed * 1000)
                item['finals' if event.get('is_final') else 'partials'] += 1
                latest[source] = max(latest[source], event.get('end_time', 0))
                # Includes provider decoding / VAD; inspect partials separately.
                if not event.get('is_final'):
                    worst[source] = max(worst[source], elapsed * 1000 - event.get('end_time', 0))
    receiving = asyncio.create_task(receive())
    try:
        for index in range(frames):
            await asyncio.sleep(max(0, started + index * .04 - time.monotonic()))
            if args.stall_ms and index and index % round(args.stall_every * 25) == 0:
                await asyncio.sleep(args.stall_ms / 1000)
            data = pcm[index * 1280:(index + 1) * 1280]
            for session in sessions:
                await session.feed_wait(data)
                item = stats[session._source]
                item['max_queue_frames'] = max(item['max_queue_frames'], session._send_queue.qsize())
                pending = (index + 1) * 1280 - item['bytes']
                item['max_pending_audio_ms'] = max(item['max_pending_audio_ms'], pending / 32)
            if index and index % 750 == 0:
                print(json.dumps({'progress_seconds': index // 25, 'sources': stats}), flush=True)
        await asyncio.gather(*(session.finish() for session in sessions))
        await asyncio.sleep(.05)
    finally:
        receiving.cancel()
        await asyncio.gather(receiving, return_exceptions=True)
        await asyncio.gather(*(session.finish() for session in sessions), return_exceptions=True)
    expected = hashlib.sha256(pcm).hexdigest()
    for source, item in stats.items():
        item['all_audio_sent_in_order'] = item['bytes'] == len(pcm) and digests[source].hexdigest() == expected
        item['last_result_end_ms'] = latest[source]
        item['worst_partial_lag_ms'] = round(worst[source])
        item['final_send_lag_ms'] = round(send_lags[source][-1])
        item['max_send_lag_ms'] = round(max(send_lags[source]))
    result = {'duration_seconds': args.seconds, 'sources': stats}
    print(json.dumps(result, indent=2), flush=True)
    if args.report: Path(args.report).write_text(json.dumps(result, indent=2) + '\n')
    assert all(item['all_audio_sent_in_order'] and item['partials'] and item['finals'] and not item['errors'] for item in stats.values()), 'Provider check did not pass'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', required=True)
    parser.add_argument('--wav', required=True)
    parser.add_argument('--seconds', type=int, default=180)
    parser.add_argument('--dual', action='store_true')
    parser.add_argument('--gap-ms', type=int, default=1000)
    parser.add_argument('--stall-ms', type=int, default=0)
    parser.add_argument('--stall-every', type=int, default=10)
    parser.add_argument('--report')
    args = parser.parse_args()
    assert 1 <= args.seconds <= 3600
    assert 0 <= args.gap_ms <= 10000 and 0 <= args.stall_ms <= 5000 and args.stall_every >= 5
    from dotenv import load_dotenv
    load_dotenv(args.env)
    asyncio.run(check(args))

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const transport = vi.hoisted(() => ({
  frames: [] as Buffer[],
  controls: [] as Record<string, unknown>[],
  order: [] as string[],
}));

// Exercise the real capture manager, PCM normalization, accumulators and wire
// encoder without opening a socket or recording a physical audio device.
vi.mock('../audio/stream-client.js', async () => {
  const {EventEmitter} = await import('events');
  return {
    StreamClient: class extends EventEmitter {
      private ready = false;
      async connect() {
        this.ready = true;
      }
      disconnect() {
        this.ready = false;
      }
      isReady() {
        return this.ready;
      }
      async waitForControl() {
        return {};
      }
      sendControl(message: Record<string, unknown>) {
        transport.controls.push(message);
        transport.order.push(String(message.type));
      }
      sendFrame(frame: Buffer) {
        transport.frames.push(Buffer.from(frame));
        transport.order.push('frame');
      }
    },
  };
});

import {AudioCaptureManager} from '../audio/audio-capture';

const sessionId = '12345678-1234-5678-9abc-123456789abc';
const managers: AudioCaptureManager[] = [];

function pcm(samples: number, sign: 1 | -1): Buffer {
  const result = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) result.writeInt16LE(sign * (1000 + i), i * 2);
  return result;
}

function decode(frame: Buffer) {
  expect(frame.subarray(0, 4).toString()).toBe('ACP1');
  expect(frame[4]).toBe(1);
  expect(frame[5]).toBe(1);
  expect(frame.subarray(8, 24).toString('hex')).toBe(sessionId.replaceAll('-', ''));
  expect(frame.readUInt32BE(40)).toBe(frame.length - 44);
  return {
    source: frame[6],
    final: frame[7] === 1,
    sequence: Number(frame.readBigUInt64BE(24)),
    offsetUs: Number(frame.readBigUInt64BE(32)),
    pcm: frame.subarray(44),
  };
}

beforeEach(() => {
  transport.frames.length = 0;
  transport.controls.length = 0;
  transport.order.length = 0;
  // Select renderer-provided system audio on every CI host; never load WASAPI.
  vi.stubGlobal(
    'process',
    new Proxy(process, {
      get: (target, key, receiver) =>
        key === 'platform' ? 'darwin' : Reflect.get(target, key, receiver),
    }),
  );
});

afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.stop()));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function start(source: 'both' | 'mic') {
  const manager = new AudioCaptureManager();
  managers.push(manager);
  await manager.start(source, sessionId, 'wss://audio.test/stream', 'test-token', '__screen_capture__');
  return manager;
}

describe('microphone and system PCM isolation', () => {
  it.each(['mic', 'system'] as const)('reports a missing %s track even when the other track sends frames', async missing => {
    vi.useFakeTimers();
    const manager = await start('both');
    const errors = vi.fn();
    manager.on('error', errors);
    if (missing === 'system') manager.pushMicFrame(pcm(640, 1));
    else manager.pushSystemFrame(pcm(640, -1));
    await vi.advanceTimersByTimeAsync(8000);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({code: 'E_NO_SIGNAL', source: missing, recoverable: true}));
  });
  it('does not treat quiet PCM as a missing device or require an unselected system track', async () => {
    vi.useFakeTimers();
    const manager = await start('mic');
    const errors = vi.fn();
    manager.on('error', errors);
    manager.pushMicFrame(Buffer.alloc(1280));
    await vi.advanceTimersByTimeAsync(8000);
    expect(errors).not.toHaveBeenCalled();
  });
  it('keeps interleaved chunks, sequence counters and flushed tails on their original source', async () => {
    const manager = await start('both');
    const mic = pcm(1500, 1),
      system = pcm(2100, -1);

    // Deliberately cross the 640-sample frame boundary at different times.
    manager.pushMicFrame(mic.subarray(0, 260));
    manager.pushSystemFrame(system.subarray(0, 960));
    manager.pushMicFrame(mic.subarray(260, 1660));
    manager.pushSystemFrame(system.subarray(960, 2260));
    manager.pushMicFrame(mic.subarray(1660, 1690));
    manager.pushSystemFrame(system.subarray(2260, 2266));
    manager.pushSystemFrame(system.subarray(2266));
    manager.pushMicFrame(mic.subarray(1690));

    const beforeStop = transport.frames.map(decode);
    expect(beforeStop.filter(frame => frame.source === 1)).toHaveLength(2);
    expect(beforeStop.filter(frame => frame.source === 2)).toHaveLength(3);
    expect(beforeStop.every(frame => frame.pcm.length === 1280 && !frame.final)).toBe(true);

    await manager.stop();

    const packets = transport.frames.map(decode);
    const micPackets = packets.filter(frame => frame.source === 1);
    const systemPackets = packets.filter(frame => frame.source === 2);
    expect(packets).toHaveLength(7);
    expect(Buffer.concat(micPackets.map(frame => frame.pcm))).toEqual(mic);
    expect(Buffer.concat(systemPackets.map(frame => frame.pcm))).toEqual(system);
    expect(
      micPackets.map(frame => [frame.sequence, frame.offsetUs, frame.final, frame.pcm.length]),
    ).toEqual([
      [0, 0, false, 1280],
      [1, 40000, false, 1280],
      [2, 80000, true, 440],
    ]);
    expect(
      systemPackets.map(frame => [frame.sequence, frame.offsetUs, frame.final, frame.pcm.length]),
    ).toEqual([
      [0, 0, false, 1280],
      [1, 40000, false, 1280],
      [2, 80000, false, 1280],
      [3, 120000, true, 360],
    ]);
    expect(transport.controls.filter(message => message.type === 'track_end')).toEqual([
      {type: 'track_end', session_id: sessionId, source: 'mic', last_sequence: 2},
      {type: 'track_end', session_id: sessionId, source: 'system', last_sequence: 3},
    ]);
    expect(transport.order.lastIndexOf('frame')).toBeLessThan(transport.order.indexOf('track_end'));

    manager.pushMicFrame(mic);
    manager.pushSystemFrame(system);
    await manager.stop();
    expect(transport.frames).toHaveLength(7);
  });

  it('does not relabel an unconfigured system source as microphone audio', async () => {
    const manager = await start('mic');
    const mic = pcm(111, 1);
    manager.pushSystemFrame(pcm(1400, -1));
    manager.pushMicFrame(mic);
    await manager.stop();

    expect(transport.frames).toHaveLength(1);
    expect(decode(transport.frames[0]!)).toEqual({
      source: 1,
      final: true,
      sequence: 0,
      offsetUs: 0,
      pcm: mic,
    });
    expect(
      transport.controls
        .filter(message => message.type === 'track_start')
        .map(message => message.source),
    ).toEqual(['mic']);
  });
});

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {WasapiCapture} from '../audio/windows-loopback';

const fixture = vi.hoisted(() => ({
  createNative: vi.fn(),
  frames: [] as Buffer[],
  controls: [] as Record<string, unknown>[],
  connects: 0,
  disconnects: 0,
  connectError: null as Error | null,
  frameError: null as Error | null,
  stopConfirmation: null as Promise<void> | null,
}));

vi.mock('../audio/windows-loopback.js', () => ({createWindowsLoopback: fixture.createNative}));
vi.mock('../audio/stream-client.js', async () => {
  const {EventEmitter} = await import('events');
  return {
    StreamClient: class extends EventEmitter {
      private ready = false;
      async connect() {
        fixture.connects += 1;
        if (fixture.connectError) throw fixture.connectError;
        this.ready = true;
      }
      disconnect() {
        this.ready = false;
        fixture.disconnects += 1;
      }
      isReady() {
        return this.ready;
      }
      async waitForControl(type: string) {
        if (type === 'session_stopped') await fixture.stopConfirmation;
        return {};
      }
      sendControl(message: Record<string, unknown>) {
        fixture.controls.push(message);
      }
      sendFrame(frame: Buffer) {
        if (fixture.frameError) throw fixture.frameError;
        fixture.frames.push(Buffer.from(frame));
      }
    },
  };
});

import {AudioCaptureManager} from '../audio/audio-capture';

const sessionId = '12345678-1234-5678-9abc-123456789abc';
const instances: AudioCaptureManager[] = [];
let releaseStop: (() => void) | null = null;

function nativeDevice() {
  let callback: Parameters<WasapiCapture['start']>[0] | null = null;
  const device: WasapiCapture & {
    deliver: (error: (Error & {code?: string}) | null, data?: Buffer) => void;
  } = {
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
    isFloat: false,
    start: vi.fn(value => {
      callback = value;
    }),
    stop: vi.fn(),
    deliver: (error, data) => callback?.(error, data ?? null),
  };
  return device;
}

function manager() {
  const result = new AudioCaptureManager();
  result.on('error', () => {});
  instances.push(result);
  return result;
}

function start(capture: AudioCaptureManager, deviceId?: string) {
  return capture.start('both', sessionId, 'wss://audio.test/stream', 'test-token', deviceId);
}

beforeEach(() => {
  fixture.createNative.mockReset();
  fixture.frames.length = 0;
  fixture.controls.length = 0;
  fixture.connects = 0;
  fixture.disconnects = 0;
  fixture.connectError = null;
  fixture.frameError = null;
  fixture.stopConfirmation = null;
  vi.stubGlobal(
    'process',
    new Proxy(process, {
      get: (target, key, receiver) =>
        key === 'platform' ? 'win32' : Reflect.get(target, key, receiver),
    }),
  );
});

afterEach(async () => {
  releaseStop?.();
  releaseStop = null;
  await Promise.all(instances.splice(0).map(capture => capture.stop()));
  vi.unstubAllGlobals();
});

describe('Windows native capture lifecycle without recording hardware', () => {
  it('rejects invalid sources before loading devices or opening a connection', async () => {
    const capture = manager();
    await expect(
      capture.start('invalid' as 'both', sessionId, 'wss://audio.test', 'test'),
    ).rejects.toThrow('无效的音频来源');
    expect(fixture.createNative).not.toHaveBeenCalled();
    expect(fixture.connects).toBe(0);
  });

  it('keeps microphone-only operation independent of a missing WASAPI component', async () => {
    const capture = manager();
    await capture.start('mic', sessionId, 'wss://audio.test', 'test');
    capture.pushSystemFrame(Buffer.alloc(1280));
    capture.pushMicFrame(Buffer.alloc(1280));
    expect(fixture.createNative).not.toHaveBeenCalled();
    expect(fixture.frames.map(frame => frame[6])).toEqual([1]);
  });

  it('selects the requested output and accepts system frames only from WASAPI', async () => {
    const native = nativeDevice();
    fixture.createNative.mockReturnValue(native);
    const capture = manager();
    await start(capture, 'conference-headphones');
    expect(fixture.createNative).toHaveBeenCalledWith('conference-headphones');
    capture.pushSystemFrame(Buffer.alloc(1280));
    native.deliver(null, Buffer.alloc(1282));
    capture.pushMicFrame(Buffer.alloc(1280));
    expect(fixture.frames.map(frame => frame[6])).toEqual([2, 1]);
    await capture.stop();
    expect(native.stop).toHaveBeenCalledOnce();
  });

  it('fails before a network connection when the native component or endpoint is unavailable', async () => {
    fixture.createNative.mockImplementation(() => {
      throw new Error('所选输出设备已断开');
    });
    const capture = manager();
    await expect(start(capture)).rejects.toThrow('所选输出设备已断开');
    expect(capture.getState()).toBe('idle');
    expect(fixture.connects).toBe(0);
  });

  it('releases the prepared native object when connecting fails', async () => {
    const native = nativeDevice();
    fixture.createNative.mockReturnValue(native);
    fixture.connectError = new Error('mock backend unavailable');
    const capture = manager();
    await expect(start(capture)).rejects.toThrow('backend unavailable');
    expect(native.start).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(fixture.disconnects).toBe(1);
    expect(capture.getSnapshot()).toMatchObject({captureState: 'idle', sessionId: null});
  });

  it('cleans up a throwing native start and allows a fresh attempt', async () => {
    const broken = nativeDevice(),
      next = nativeDevice();
    vi.mocked(broken.start).mockImplementation(() => {
      throw new Error('output format changed');
    });
    fixture.createNative.mockReturnValueOnce(broken).mockReturnValueOnce(next);
    const capture = manager();
    await expect(start(capture)).rejects.toThrow('output format changed');
    expect(broken.stop).toHaveBeenCalledOnce();
    expect(fixture.disconnects).toBe(1);
    expect(capture.getState()).toBe('completed');
    await start(capture);
    next.deliver(null, Buffer.alloc(1282));
    expect(fixture.frames).toHaveLength(1);
  });

  it('does not report success or start timers after a synchronous native failure', async () => {
    const native = nativeDevice();
    vi.mocked(native.start).mockImplementation(callback =>
      callback(new Error('device unavailable at start'), null),
    );
    fixture.createNative.mockReturnValue(native);
    const capture = manager();
    await expect(start(capture)).rejects.toThrow('device unavailable at start');
    expect(native.stop).toHaveBeenCalledOnce();
    expect(fixture.disconnects).toBe(1);
    expect(capture.getState()).toBe('completed');
  });

  it('stops both tracks on a device loss, drains once, and ignores old callbacks after resume', async () => {
    const oldNative = nativeDevice(),
      nextNative = nativeDevice();
    fixture.createNative.mockReturnValueOnce(oldNative).mockReturnValueOnce(nextNative);
    const capture = manager();
    const errors: unknown[] = [];
    capture.on('error', error => errors.push(error));
    await start(capture);
    oldNative.deliver(null, Buffer.alloc(320));
    fixture.stopConfirmation = new Promise(resolve => {
      releaseStop = resolve;
    });
    const loss = Object.assign(new Error('默认输出设备已切换，请继续以使用新设备'), {
      code: 'WASAPI_DEFAULT_DEVICE_CHANGED',
    });
    oldNative.deliver(loss);
    expect(capture.getState()).toBe('preparing');
    expect(oldNative.stop).toHaveBeenCalledOnce();
    const firstStop = capture.stop(),
      secondStop = capture.stop();
    expect(firstStop).toBe(secondStop);
    await expect(start(capture)).rejects.toThrow('E_STATE');
    oldNative.deliver(null, Buffer.alloc(1282));
    capture.pushMicFrame(Buffer.alloc(1280));
    expect(fixture.frames).toHaveLength(1); // only the flushed original 320-byte tail
    expect(fixture.frames[0]![7]).toBe(1);
    releaseStop!();
    await firstStop;
    expect(fixture.disconnects).toBe(1);
    await start(capture);
    oldNative.deliver(null, Buffer.alloc(1282));
    oldNative.deliver(loss);
    nextNative.deliver(null, Buffer.alloc(1282));
    expect(capture.getState()).toBe('capturing');
    expect(fixture.frames).toHaveLength(2);
    expect(fixture.frames[1]!.readBigUInt64BE(24)).toBe(0n);
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'WASAPI_DEFAULT_DEVICE_CHANGED',
        recoverable: false,
        stage: 'capture',
      }),
    ]);
  });

  it('rejects unsupported native formats without silently applying guessed defaults', async () => {
    const native = nativeDevice();
    native.sampleRate = 0;
    fixture.createNative.mockReturnValue(native);
    const capture = manager();
    await expect(start(capture)).rejects.toThrow('格式不受支持');
    expect(native.start).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(fixture.disconnects).toBe(1);
  });

  it('normalizes Float32 Windows loopback PCM without changing the source', async () => {
    const native = nativeDevice();
    native.bitsPerSample = 32;
    native.isFloat = true;
    fixture.createNative.mockReturnValue(native);
    const capture = manager();
    await start(capture);
    const pcm = Buffer.alloc(641 * 4 + 1);
    for (let index = 0; index < 641; index++) pcm.writeFloatLE(-0.5, 1 + index * 4);
    native.deliver(null, pcm.subarray(1));
    expect(fixture.frames).toHaveLength(1);
    expect(fixture.frames[0]![6]).toBe(2);
    expect(fixture.frames[0]!.readInt16LE(44)).toBe(-16383);
  });

  it.each([24, 32])('normalizes signed %i-bit PCM and flushes the resampling tail', async bits => {
    const native = nativeDevice();
    native.bitsPerSample = bits;
    fixture.createNative.mockReturnValue(native);
    const capture = manager();
    await start(capture);
    const bytes = bits / 8;
    const pcm = Buffer.alloc(641 * bytes);
    for (let index = 0; index < 641; index++) pcm.writeIntLE(-(2 ** (bits - 2)), index * bytes, bytes);
    native.deliver(null, pcm);
    await capture.stop();
    expect(fixture.frames).toHaveLength(2);
    expect(fixture.frames[0]!.readInt16LE(44)).toBe(-16384);
    expect(fixture.frames[1]!.subarray(44)).toEqual(Buffer.from([0, 192]));
    expect(fixture.frames[1]![7]).toBe(1);
  });

  it('still disconnects and clears native state if flushing races a transport failure', async () => {
    const native = nativeDevice();
    fixture.createNative.mockReturnValue(native);
    const capture = manager();
    const errors: unknown[] = [];
    capture.on('error', error => errors.push(error));
    await start(capture);
    native.deliver(null, Buffer.alloc(320));
    fixture.frameError = new Error('socket closed during tail send');
    await expect(capture.stop()).resolves.toBeUndefined();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(fixture.disconnects).toBe(1);
    expect(capture.getSnapshot()).toMatchObject({captureState: 'completed', sessionId: null, levels: {mic: 0, system: 0}});
    expect(errors).toEqual([expect.objectContaining({code: 'E_STOP_CONFIRM'})]);
  });
});

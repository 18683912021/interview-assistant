import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {probeMacAudio} from '../audio/macos-loopback';
import type {WasapiCapture} from '../audio/windows-loopback';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  let emit!: Parameters<WasapiCapture['start']>[0];
  const stop = vi.fn(), stopTone = vi.fn(), playTone = vi.fn(() => stopTone);
  const capture: WasapiCapture = {sampleRate: 48000, channels: 2, isFloat: true, bitsPerSample: 32,
    start: callback => {emit = callback;}, stop};
  return {...probeMacAudio(capture, playTone), emit: (...args: Parameters<typeof emit>) => emit(...args), stop, stopTone, playTone};
}
it('waits for permission/start readiness then generates its own local test signal', async () => {
  const probe = fixture();
  await vi.advanceTimersByTimeAsync(20000);
  expect(probe.playTone).not.toHaveBeenCalled();
  probe.emit(null, null);
  expect(probe.playTone).toHaveBeenCalledOnce();
  const pcm = Buffer.alloc(8); pcm.writeFloatLE(0.05);
  probe.emit(null, pcm);
  await vi.advanceTimersByTimeAsync(3000);
  await expect(probe.result).resolves.toMatchObject({signal: true});
  expect(probe.stopTone).toHaveBeenCalledOnce();
  expect(probe.stop).toHaveBeenCalledOnce();
});
it('does not turn a started device with no PCM into a successful permission check', async () => {
  const probe = fixture();
  const result = expect(probe.result).rejects.toThrow('自检未通过');
  probe.emit(null, null);
  await vi.advanceTimersByTimeAsync(3000);
  await result;
  expect(probe.stopTone).toHaveBeenCalledOnce();
});
it('reports silent PCM separately from verified playback', async () => {
  const probe = fixture();
  probe.emit(null, null); probe.emit(null, Buffer.alloc(8));
  await vi.advanceTimersByTimeAsync(3000);
  await expect(probe.result).resolves.toMatchObject({signal: false});
});
it('cancel stops test playback and ignores late native callbacks', async () => {
  const probe = fixture();
  const result = expect(probe.result).rejects.toThrow('已取消');
  probe.emit(null, null); probe.cancel(); probe.emit(null, Buffer.alloc(8));
  await result;
  await vi.advanceTimersByTimeAsync(30000);
  expect(probe.playTone).toHaveBeenCalledOnce();
  expect(probe.stop).toHaveBeenCalledOnce();
  expect(probe.stopTone).toHaveBeenCalledOnce();
});
it('denial before readiness never plays a test tone', async () => {
  const probe = fixture();
  const result = expect(probe.result).rejects.toThrow('denied');
  probe.emit(new Error('denied'), null); probe.emit(null, null);
  await result;
  expect(probe.playTone).not.toHaveBeenCalled();
});

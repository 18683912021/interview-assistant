// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, renderHook} from '@testing-library/react';
import {useAudioCapture} from './useAudioCapture';
import {DEFAULT_SETTINGS} from '../api/workspace';
vi.mock('../config', () => ({MAIN_STREAM_URL: 'wss://audio.test', STREAM_DIRECT_ADDRESS: '', API_BASE: ''}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}
function microphone() {
  const track = {readyState: 'live', getSettings: () => ({echoCancellation: true}), addEventListener: vi.fn(), stop: vi.fn()};
  return {track, stream: {getAudioTracks: () => [track], getTracks: () => [track]} as unknown as MediaStream};
}
afterEach(() => {cleanup(); delete window.electronAPI; vi.unstubAllGlobals();});

describe('cancelled capture preparation', () => {
  it.each(['permission', 'worklet'])('a stale %s result cannot clear a newer prepared microphone', async stage => {
    const oldMic = microphone(), newMic = microphone();
    const permission = deferred<MediaStream>(), worklet = deferred<void>();
    const getUserMedia = vi.fn().mockReturnValueOnce(stage === 'permission' ? permission.promise : Promise.resolve(oldMic.stream))
      .mockResolvedValueOnce(newMic.stream);
    vi.stubGlobal('navigator', {userAgent: 'test', mediaDevices: {getUserMedia}});
    let contexts = 0;
    vi.stubGlobal('AudioContext', class {
      audioWorklet = {addModule: vi.fn(() => (++contexts === 1 && stage === 'worklet') ? worklet.promise : Promise.resolve())};
      createMediaStreamSource = () => ({connect: vi.fn()});
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    });
    vi.stubGlobal('AudioWorkletNode', class {port = {postMessage: vi.fn(), onmessage: null}; disconnect = vi.fn();});
    const off = () => () => {};
    window.electronAPI = {audio: {
      onState: off, onTranscription: off, onLLMStart: off, onLLMChunk: off, onLLMDone: off,
      onStreamState: off, onLevels: off, onError: off,
      stopCapture: vi.fn().mockResolvedValue(undefined), cancelSystemAudioCheck: vi.fn().mockResolvedValue(undefined),
    }} as unknown as NonNullable<Window['electronAPI']>;
    const {result} = renderHook(() => useAudioCapture());
    let first!: Promise<unknown>;
    await act(async () => {first = result.current.prepare(DEFAULT_SETTINGS, 'mic').catch(error => error);});
    act(() => result.current.discardPreparation());
    const newerSettings = {...DEFAULT_SETTINGS, microphone_id: 'new-mic'};
    await act(async () => {await result.current.prepare(newerSettings, 'mic');});
    await act(async () => {permission.resolve(oldMic.stream); worklet.resolve(); await first;});
    expect(() => result.current.assertPrepared(newerSettings, 'mic')).not.toThrow();
    expect(oldMic.track.stop).toHaveBeenCalled();
    expect(newMic.track.stop).not.toHaveBeenCalled();
    expect(result.current.preparation.mic?.status).toBe('ready');
    // A deliberate recheck must reacquire input instead of reusing cached success.
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await act(async () => {await expect(result.current.prepare(newerSettings, 'mic', true)).rejects.toMatchObject({source: 'mic'});});
    expect(result.current.preparation.mic?.status).toBe('error');
    expect(newMic.track.stop).toHaveBeenCalled();
  });
});

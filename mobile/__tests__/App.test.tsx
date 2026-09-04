import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react');
  return {
    SafeAreaProvider: ({children}: {children: React.ReactNode}) =>
      ReactLib.createElement(ReactLib.Fragment, null, children),
    SafeAreaView: ({children}: {children: React.ReactNode}) =>
      ReactLib.createElement(ReactLib.Fragment, null, children),
  };
});

jest.mock(
  '../src/hooks/useAudioCaptureController',
  () => ({
    useAudioCaptureController: () => ({
      state: {
        capabilities: {
          apiLevel: 35,
          microphone: true,
          systemAudio: true,
          outputSampleRate: 16000,
          outputChannels: 1,
          outputBitDepth: 16,
          chunkDurationMs: 40,
        },
        captureState: 'idle',
        streamState: 'idle',
        source: 'mic',
        projectionGranted: false,
        levels: {mic: 0, system: 0},
        streamStats: {
          queuedBytes: 0,
          transportBytes: 0,
          acknowledgedBytes: 0,
          realtimeFrames: 0,
          droppedFrames: 0,
          backfillBytes: 0,
        },
        startedAtUtc: null,
        result: null,
        pendingBackfill: false,
        error: null,
        streamMessage: null,
      },
      isBusy: false,
      canUseSystem: true,
      needsProjection: false,
      setSource: jest.fn(),
      authorizeSystemAudio: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      retryBackfill: jest.fn(),
      shareOutput: jest.fn(),
      clearError: jest.fn(),
    }),
  }),
);

import App from '../App';

test('renders the audio capture screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(JSON.stringify(renderer!.toJSON())).toContain('Audio Capture Lab');
  ReactTestRenderer.act(() => renderer!.unmount());
});

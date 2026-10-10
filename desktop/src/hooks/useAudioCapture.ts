import {useReducer, useCallback, useEffect, useRef, useState} from 'react';
import {interviewReducer, INITIAL_STATE, genId} from '../store/interview-reducer';
import {MAIN_STREAM_URL, STREAM_DIRECT_ADDRESS} from '../config';
import {
  prepareAudioStreams,
  releaseStreams,
  type PreparedStreams,
} from '../services/capture-preparation';
import {getToken} from '../utils/token';
import {resumeExcerpt} from '../services/answer-context';
import type {Settings} from '../api/workspace';
import type {ConversationAnswer} from '../store/types';
import {microphoneEchoMode, type MicrophoneEchoMode} from '../services/microphone-capture';
import {
  assertSystemOutput,
  desktopPlatform,
  listSystemOutputs,
} from '../services/audio-device-settings';

type AudioHandle = {
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
  flushAck?: () => void;
};
async function flushAudio(handle: AudioHandle | null): Promise<boolean> {
  if (!handle) return true;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      handle.flushAck = undefined;
      resolve(false);
    }, 300);
    handle.flushAck = () => {
      clearTimeout(timer);
      handle.flushAck = undefined;
      resolve(true);
    };
    handle.node.port.postMessage({type: 'flush', id: crypto.randomUUID()});
  });
}
export interface AnswerContext {
  role: string;
  job_description: string;
  resume_text: string;
  language: string;
  answer_length: string;
  answer_style: string;
  context_version: number;
  resume_version?: number;
}
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
function closeAudio(handle: AudioHandle | null) {
  if (!handle) return;
  handle.stream.getTracks().forEach(track => track.stop());
  handle.node.port.onmessage = null;
  handle.node.disconnect();
  void handle.ctx.close().catch(() => {});
}

export function useAudioCapture() {
  const [state, dispatch] = useReducer(interviewReducer, INITIAL_STATE);
  const api = window.electronAPI?.audio;
  const stateRef = useRef(state);
  stateRef.current = state;
  const micRef = useRef<AudioHandle | null>(null);
  const sysRef = useRef<AudioHandle | null>(null);
  const stoppingRef = useRef(false);
  const startEpoch = useRef(0);
  const preparedKey = useRef<string | null>(null);
  const forwarding = useRef(false);
  const [settling, setSettling] = useState(false);
  const [echoMode, setEchoMode] = useState<MicrophoneEchoMode | null>(null);
  const nativeStopTask = useRef<Promise<void> | null>(null);
  const stopNative = useCallback(() => {
    if (nativeStopTask.current) return nativeStopTask.current;
    if (!api) return Promise.resolve();
    setSettling(true);
    const task = api.stopCapture().finally(() => {
      if (nativeStopTask.current === task) {
        nativeStopTask.current = null;
        setSettling(false);
      }
    });
    nativeStopTask.current = task;
    return task;
  }, [api]);
  const stopLocal = useCallback(() => {
    forwarding.current = false;
    setEchoMode(null);
    preparedKey.current = null;
    closeAudio(micRef.current);
    closeAudio(sysRef.current);
    micRef.current = null;
    sysRef.current = null;
  }, []);

  const pauseForLoss = useCallback(
    (message: string) => {
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      startEpoch.current++;
      stopLocal();
      dispatch({type: 'settle'});
      dispatch({type: 'captureState', value: 'paused'});
      dispatch({
        type: 'error',
        value: {code: 'E_CAPTURE_LOST', stage: 'capture', message, recoverable: true},
      });
      dispatch({type: 'asr_error', message});
      void stopNative().catch(() => {});
    },
    [stopNative, stopLocal],
  );

  useEffect(() => {
    if (!api) return;
    const offs = [
      api.onState(raw => {
        const evt = raw as {state?: typeof state.captureState};
        if (evt.state && evt.state !== 'capturing' && !stoppingRef.current)
          dispatch({type: 'captureState', value: evt.state});
      }),
      api.onTranscription(raw => {
        const evt = raw as {
          text: string;
          is_final: boolean;
          source: 'mic' | 'system';
          utterance_id?: string;
          revision?: number;
          start_time?: number;
          end_time?: number;
        };
        if (typeof evt.text !== 'string') return;
        dispatch({
          type: 'transcription',
          text: evt.text,
          isFinal: evt.is_final,
          source: evt.source,
          timestamp: Date.now(),
          utteranceId: evt.utterance_id,
          revision: evt.revision,
          startTime: evt.start_time,
          endTime: evt.end_time,
        });
      }),
      api.onLLMStart(raw => {
        const evt = raw as {request_id: string};
        dispatch({type: 'llm_start', requestId: evt.request_id, timestamp: Date.now()});
      }),
      api.onLLMChunk(raw => {
        const evt = raw as {request_id: string; delta: string; chunk_index?: number};
        if (evt.delta)
          dispatch({
            type: 'llm_chunk',
            requestId: evt.request_id,
            delta: evt.delta,
            chunkIndex: evt.chunk_index,
            timestamp: Date.now(),
          });
      }),
      api.onLLMDone(raw => {
        const evt = raw as {
          request_id: string;
          full_answer: string;
          status?: string;
          error?: string;
          source_refs?: unknown[];
        };
        dispatch({
          type: 'llm_done',
          requestId: evt.request_id,
          full_answer: evt.full_answer ?? '',
          status: evt.status,
          error: evt.error,
          sourceRefs: evt.source_refs,
          timestamp: Date.now(),
        });
      }),
      api.onStreamState(raw => {
        const evt = raw as {state?: typeof state.streamState; message?: string};
        if (evt.state) dispatch({type: 'streamState', value: evt.state, message: evt.message});
        if ((evt.state === 'dead' || evt.state === 'closed') && !stoppingRef.current) {
          pauseForLoss('音频连接已断开，本次采集已暂停；未确认的片段已保留，请重连后继续。');
        }
      }),
      api.onLevels(raw => {
        const evt = raw as {mic?: number; system?: number};
        dispatch({type: 'levels', value: {mic: evt.mic ?? 0, system: evt.system ?? 0}});
      }),
      api.onError(raw => {
        const evt = raw as NonNullable<typeof state.error>;
        if (evt.message) {
          dispatch({type: 'error', value: evt});
          if (evt.stage === 'transcription' || evt.code?.startsWith('E_ASR')) {
            dispatch({type: 'asr_error', message: evt.message});
            if (evt.recoverable === false) pauseForLoss(evt.message);
          }
          if (evt.stage === 'capture' && evt.recoverable === false) pauseForLoss(evt.message);
        }
      }),
    ];
    return () => {
      offs.forEach(off => off());
    };
  }, [api, pauseForLoss]);

  const attachPipeline = useCallback(
    async (stream: MediaStream, send: (frame: Uint8Array) => void) => {
      const ctx = new AudioContext({sampleRate: 16000});
      try {
        await ctx.audioWorklet.addModule('./mic-processor.js');
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, 'mic-capture-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
        });
        const handle: AudioHandle = {ctx, stream, node};
        node.port.onmessage = (event: MessageEvent<ArrayBuffer | {type?: string}>) => {
          if (!(event.data instanceof ArrayBuffer)) {
            if (event.data?.type === 'flushed') handle.flushAck?.();
            return;
          }
          const samples = new Float32Array(event.data);
          const pcm = new Int16Array(samples.length);
          for (let i = 0; i < samples.length; i++)
            pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i] ?? 0)) * 32767);
          if (forwarding.current) send(new Uint8Array(pcm.buffer));
        };
        source.connect(node);
        await ctx.resume();
        stream
          .getAudioTracks()
          .forEach(track =>
            track.addEventListener(
              'ended',
              () => pauseForLoss('音频设备已断开或共享已结束，采集已暂停。请检查设备后继续。'),
              {once: true},
            ),
          );
        if (!stream.getAudioTracks().some(track => track.readyState === 'live'))
          throw new Error('音频输入已停止，请检查麦克风与系统音频权限后重试。');
        return handle;
      } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        await ctx.close();
        throw error;
      }
    },
    [pauseForLoss],
  );

  const prepare = useCallback(
    async (settings: Settings, source: 'both' | 'mic' = 'both') => {
      if (!api) throw new Error('实时采集需要在桌面客户端中打开。');
      // Do not await an old stop here: media permission must retain this click's
      // activation. The UI disables resume until the old native stream is closed.
      if (nativeStopTask.current) throw new Error('正在停止上次采集，请稍后继续。');
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('当前窗口无法访问音频设备，请重启桌面客户端。');
      const key = JSON.stringify([source, settings.microphone_id, settings.system_device_id]);
      if (
        preparedKey.current === key &&
        micRef.current?.stream.getAudioTracks().some(track => track.readyState === 'live') &&
        (source !== 'both' ||
          !/Mac/i.test(navigator.userAgent) ||
          sysRef.current?.stream.getAudioTracks().some(track => track.readyState === 'live'))
      )
        return;
      stopLocal();
      const epoch = ++startEpoch.current;
      stoppingRef.current = false;
      dispatch({type: 'error', value: null});
      dispatch({type: 'asr_error', message: null});
      dispatch({type: 'captureState', value: 'preparing'});
      let streams: PreparedStreams | null = null;
      try {
        // Windows enumeration opens no audio stream; fail before saving a new
        // session or opening provider connections if its selected output vanished.
        if (source === 'both' && desktopPlatform() === 'windows') {
          assertSystemOutput(await listSystemOutputs(), settings.system_device_id);
          if (epoch !== startEpoch.current) throw new Error('启动已取消');
        }
        streams = await prepareAudioStreams(
          settings,
          source,
          navigator.mediaDevices,
          /Mac/i.test(navigator.userAgent),
          () => epoch !== startEpoch.current,
        );
        setEchoMode(microphoneEchoMode(streams.mic));
        micRef.current = await attachPipeline(streams.mic, frame => api.sendMicFrame(frame));
        if (streams.system)
          sysRef.current = await attachPipeline(streams.system, frame =>
            api.sendSystemFrame(frame),
          );
        if (epoch !== startEpoch.current) throw new Error('启动已取消');
        preparedKey.current = key;
      } catch (error) {
        stoppingRef.current = true;
        if (streams) releaseStreams(streams);
        stopLocal();
        dispatch({type: 'captureState', value: 'paused'});
        dispatch({
          type: 'error',
          value: {
            code: 'E_DEVICES',
            stage: 'devices',
            message: messageOf(error),
            recoverable: true,
          },
        });
        throw error;
      }
    },
    [api, attachPipeline, stopLocal],
  );

  const discardPreparation = useCallback(() => {
    startEpoch.current++;
    stoppingRef.current = true;
    stopLocal();
    dispatch({type: 'captureState', value: 'paused'});
  }, [stopLocal]);

  const assertPrepared = useCallback((settings: Settings, source: 'both' | 'mic') => {
    const key = JSON.stringify([source, settings.microphone_id, settings.system_device_id]);
    const live = (handle: AudioHandle | null) =>
      handle?.stream.getAudioTracks().some(track => track.readyState === 'live');
    if (
      preparedKey.current !== key ||
      !live(micRef.current) ||
      (source === 'both' && /Mac/i.test(navigator.userAgent) && !live(sysRef.current))
    ) {
      throw new Error('音频准备已取消或设备已断开，请检查设备后重新开始。');
    }
  }, []);

  const start = useCallback(
    async (sessionId: string, settings: Settings, source: 'both' | 'mic' = 'both') => {
      if (!api) throw new Error('实时采集需要在桌面客户端中打开。');
      assertPrepared(settings, source);
      const epoch = startEpoch.current;
      try {
        const token = await getToken();
        if (!token) throw new Error('登录已失效，请重新登录。');
        if (epoch !== startEpoch.current) throw new Error('启动已取消');
        await api.startCapture({
          source,
          streamUrl: MAIN_STREAM_URL,
          directAddress: STREAM_DIRECT_ADDRESS,
          sessionId,
          token,
          ...(desktopPlatform() === 'windows' ? {systemDeviceId: settings.system_device_id} : {}),
        });
        if (epoch !== startEpoch.current) throw new Error('启动已取消');
        await api.sendControl({type: 'config', language: settings.language});
        if (epoch !== startEpoch.current) throw new Error('启动已取消');
        forwarding.current = true;
        dispatch({type: 'source', value: source});
        dispatch({type: 'captureState', value: 'capturing'});
      } catch (error) {
        discardPreparation();
        await stopNative().catch(() => {});
        dispatch({
          type: 'error',
          value: {code: 'E_START', stage: 'capture', message: messageOf(error), recoverable: true},
        });
        throw error;
      }
    },
    [api, assertPrepared, discardPreparation, stopNative],
  );

  const cancelAnswer = useCallback(
    (requestId: string) => {
      dispatch({type: 'cancel_answer', requestId});
      void api?.sendControl({type: 'llm_cancel', request_id: requestId}).catch(() => {});
    },
    [api],
  );
  const stop = useCallback(
    async (pause = false) => {
      startEpoch.current++;
      stoppingRef.current = true;
      stateRef.current.answers
        .filter(answer => answer.status === 'loading' || answer.status === 'streaming')
        .forEach(answer => cancelAnswer(answer.request_id));
      const flushed = await Promise.all([flushAudio(micRef.current), flushAudio(sysRef.current)]);
      if (flushed.some(value => !value))
        dispatch({type: 'asr_error', message: '尾部音频未确认，请核对最后一句转写。'});
      stopLocal();
      try {
        await stopNative();
      } finally {
        dispatch({type: 'settle'});
        dispatch({type: 'captureState', value: pause ? 'paused' : 'completed'});
        dispatch({type: 'streamState', value: 'idle'});
      }
    },
    [cancelAnswer, stopLocal, stopNative],
  );
  useEffect(
    () => () => {
      startEpoch.current++;
      stopLocal();
      void stopNative().catch(() => {});
    },
    [stopNative, stopLocal],
  );

  const sendLLMQuery = useCallback(
    (messageIds: string[], context: AnswerContext): string | null => {
      if (!api || stateRef.current.streamState !== 'ready') return null;
      const selected = stateRef.current.conversation.filter(message =>
        messageIds.includes(message.id),
      );
      if (!selected.length) return null;
      const question = selected.map(message => message.text).join('\n');
      if (selected.length > 30 || question.length > 16000) {
        dispatch({
          type: 'error',
          value: {
            code: 'E_QUESTION_LENGTH',
            stage: 'answer',
            message: '一次最多合并 30 句、16000 字，请减少所选内容。',
            recoverable: true,
          },
        });
        return null;
      }
      stateRef.current.answers
        .filter(answer => answer.status === 'loading' || answer.status === 'streaming')
        .forEach(answer => cancelAnswer(answer.request_id));
      const requestId = genId('request');
      const snapshot = {
        ...context,
        role: context.role.slice(0, 300),
        job_description: context.job_description.slice(0, 5000),
        resume_text: resumeExcerpt(context.resume_text, question),
        recent_messages: stateRef.current.conversation
          .slice(-8)
          .map(({role, text}) => ({role, text: text.slice(0, 1500)})),
      };
      const answer: ConversationAnswer = {
        id: genId('answer'),
        request_id: requestId,
        source_message_ids: selected.map(message => message.id),
        source_revisions: selected.map(message => message.revision ?? 0),
        question_text: question,
        text: '',
        status: 'loading',
        timestamp: Date.now(),
        context_version: context.context_version,
        context_snapshot: snapshot,
      };
      dispatch({type: 'answer_requested', answer});
      void api
        .sendControl({
          type: 'llm_query',
          request_id: requestId,
          question_text: answer.question_text,
          source_message_ids: answer.source_message_ids,
          source_revisions: answer.source_revisions,
          context: snapshot,
          context_version: context.context_version,
          language: context.language,
        })
        .catch(error => {
          dispatch({
            type: 'llm_done',
            requestId,
            full_answer: '',
            error: messageOf(error),
            status: 'failed',
            timestamp: Date.now(),
          });
        });
      return answer.id;
    },
    [api, cancelAnswer],
  );
  return {
    state,
    settling,
    echoMode,
    dispatch,
    prepare,
    assertPrepared,
    discardPreparation,
    start,
    stop,
    sendLLMQuery,
    cancelAnswer,
  };
}

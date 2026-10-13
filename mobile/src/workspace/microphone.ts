import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import {getToken} from '../utils/token';
import {STREAM_URL} from '../config';
import type {Transcript} from './model';
const native = NativeModules.AudioCapture;
const events = native ? new NativeEventEmitter(native) : null;
let drain: Promise<void> | null = null;
let finishDrain: (() => void) | null = null;
function beginDrain() {
  if (drain) {
    return;
  }
  drain = new Promise<void>(resolve => {
    const timer = setTimeout(() => finishDrain?.(), 6500);
    finishDrain = () => {
      clearTimeout(timer);
      finishDrain = null;
      drain = null;
      resolve();
    };
  });
}
export const microphone = {
  async reconcile() {
    if (!native) {
      return;
    }
    const snapshot = await native.getSnapshot();
    if (['capturing', 'preparing'].includes(snapshot.captureState)) {
      await microphone.stop();
    }
  },
  subscribe(
    onText: (event: Transcript) => void,
    onState: (state: string) => void,
    onError: (message: string) => void,
    onLevel: (n: number) => void,
  ) {
    const subscriptions = [
      events?.addListener('AudioTranscription', e => {
        try {
          onText(JSON.parse(e.json));
        } catch {
          onError('语音结果格式异常，请暂停后重试');
        }
      }),
      events?.addListener('AudioCaptureState', e => {
        if (e.state === 'stopping') {
          beginDrain();
        }
        onState(e.state);
      }),
      events?.addListener('AudioCaptureStopped', () => finishDrain?.()),
      events?.addListener('AudioStreamState', e => {
        if (['error', 'degraded', 'closed'].includes(e.state)) {
          onError(e.message || '语音连接中断，请暂停后重试');
        }
      }),
      events?.addListener('AudioCaptureError', e =>
        onError(e.message || '麦克风采集失败'),
      ),
      events?.addListener('AudioCaptureLevels', e => onLevel(e.mic)),
    ];
    return () => subscriptions.forEach(s => s?.remove());
  },
  async start(id: string) {
    if (Platform.OS !== 'android' || !native) {
      throw new Error('当前安装包未包含麦克风原生模块');
    }
    if (AppState.currentState !== 'active') {
      throw new Error('请回到应用前台后开启麦克风');
    }
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error(
        '需要麦克风权限才能转写。可以打开系统设置授权，或手动添加问题。',
      );
    }
    if (Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
    }
    const token = await getToken();
    if (!token) {
      throw new Error('请重新登录');
    }
    if (drain) {
      await drain;
    }
    if (AppState.currentState !== 'active') {
      throw new Error('请回到应用前台后开启麦克风');
    }
    await native.connectStream(STREAM_URL, token);
    try {
      await native.startCapture({operationId: id, source: 'mic'});
    } catch (e) {
      await native.disconnectStream();
      throw e;
    }
  },
  async stop() {
    let subscription: {remove(): void} | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<void>(resolve => {
      subscription = events?.addListener('AudioCaptureStopped', () =>
        resolve(),
      );
      timer = setTimeout(resolve, 6500);
    });
    try {
      await native.stopCapture();
      await stopped;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      subscription?.remove();
      await native.disconnectStream();
    }
  },
};

import {describe, expect, it} from 'vitest';
import {messageOf} from './error-message';

describe('desktop error messages', () => {
  it('removes only the IPC wrapper and preserves the actionable cause', () => {
    expect(messageOf(new Error("Error invoking remote method 'audio:check-system-audio': Error: 请允许系统音频录制")))
      .toBe('请允许系统音频录制');
    expect(messageOf(new Error('系统音频启动失败（Core Audio -50）'))).toBe('系统音频启动失败（Core Audio -50）');
  });
});

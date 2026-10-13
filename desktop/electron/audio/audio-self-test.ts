import {spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** A short, quiet local signal; never change system volume or send it to ASR. */
export function playMacTestTone(): () => void {
  const directory = mkdtempSync(join(tmpdir(), 'interview-audio-check-'));
  const file = join(directory, 'check.wav');
  const rate = 24000, frames = rate;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(1, i / 1200, (frames - i - 1) / 1200);
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 1200 * fade), 44 + i * 2);
  }
  try {
    writeFileSync(file, wav);
    const player = spawn('/usr/bin/afplay', [file], {stdio: 'ignore'});
    const cleanup = () => rmSync(directory, {recursive: true, force: true});
    player.once('error', cleanup);
    player.once('close', cleanup);
    return () => { player.kill(); cleanup(); };
  } catch (error) {
    rmSync(directory, {recursive: true, force: true});
    throw error;
  }
}

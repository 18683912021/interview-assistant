/**
 * AudioWireProtocol —— 音频二进制帧编码
 *
 * 必须和 Android 端字节级等价。
 *
 * 二进制帧头部（44字节，Big Endian）：
 *   Offset  Size  Field
 *   0       4     MAGIC "ACP1" (0x41 0x43 0x50 0x31)
 *   4       1     VERSION = 1
 *   5       1     KIND (1=REALTIME, 2=BACKFILL)
 *   6       1     SOURCE (1=MIC, 2=SYSTEM)
 *   7       1     FLAGS (1=FINAL)
 *   8       8     session_id MSB (int64 Big Endian)
 *   16      8     session_id LSB (int64 Big Endian)
 *   24      8     sequence (int64 Big Endian)
 *   32      8     capture_offset_us (int64 Big Endian)
 *   40      4     payload_length (uint32 Big Endian)
 *   44      N     payload (PCM16 LE mono)
 */

// MAGIC bytes: "ACP1"
const MAGIC = new Uint8Array([0x41, 0x43, 0x50, 0x31]);

export const PacketKind = {
  REALTIME: 1,
  BACKFILL: 2,
} as const;

export const SourceKind = {
  MIC: 1,
  SYSTEM: 2,
} as const;

const HEADER_SIZE = 44;

export interface PacketHeader {
  kind: number;
  source: number;
  flags: number;
  sessionIdMsb: bigint;
  sessionIdLsb: bigint;
  sequence: number;
  captureOffsetUs: number;
  payloadLength: number;
}

/**
 * 从 UUID 字符串提取 MSB 和 LSB（128-bit UUID → 两个 64-bit BigInt）
 *
 * parseInt 无法精确表示 64 位整数（Number.MAX_SAFE_INTEGER = 2^53-1），
 * 必须使用 BigInt 避免 UUID 高位精度丢失。
 */
export function uuidToMsbLsb(uuid: string): { msb: bigint; lsb: bigint } {
  const hex = uuid.replace(/-/g, '');
  return {
    msb: BigInt('0x' + hex.slice(0, 16)),
    lsb: BigInt('0x' + hex.slice(16, 32)),
  };
}

/**
 * 写入 64-bit Big Endian 整数到 buffer 指定偏移
 */
function writeInt64BE(view: DataView, offset: number, value: bigint): void {
  view.setBigUint64(offset, value, false); // Big Endian
}

/**
 * 编码二进制帧
 */
export function encodeFrame(header: PacketHeader, payload: Uint8Array): ArrayBuffer {
  const totalSize = HEADER_SIZE + payload.length;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // MAGIC
  bytes.set(MAGIC, 0);

  // Version
  view.setUint8(4, 1);

  // Kind
  view.setUint8(5, header.kind);

  // Source
  view.setUint8(6, header.source);

  // Flags
  view.setUint8(7, header.flags);

  // session_id MSB (8 bytes)
  writeInt64BE(view, 8, header.sessionIdMsb);

  // session_id LSB (8 bytes)
  writeInt64BE(view, 16, header.sessionIdLsb);

  // sequence (8 bytes)
  view.setBigUint64(24, BigInt(header.sequence), false);

  // capture_offset_us (8 bytes)
  view.setBigUint64(32, BigInt(header.captureOffsetUs), false);

  // payload_length (4 bytes)
  view.setUint32(40, payload.length, false); // Big Endian

  // payload
  bytes.set(payload, HEADER_SIZE);

  return buffer;
}

/**
 * 编码实时音频帧（便捷方法）
 */
export function encodeRealtimeFrame(
  sessionId: string,
  source: number,
  sequence: number,
  captureOffsetUs: number,
  payload: Uint8Array,
  isFinal: boolean = false,
): ArrayBuffer {
  const { msb, lsb } = uuidToMsbLsb(sessionId);

  return encodeFrame(
    {
      kind: PacketKind.REALTIME,
      source,
      flags: isFinal ? 1 : 0,
      sessionIdMsb: msb,
      sessionIdLsb: lsb,
      sequence,
      captureOffsetUs,
      payloadLength: payload.length,
    },
    payload,
  );
}

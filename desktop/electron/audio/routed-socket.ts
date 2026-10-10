import {EventEmitter} from 'node:events';
import {isIP, type LookupFunction} from 'node:net';
import WebSocket from 'ws';

export type StreamSocket = Pick<WebSocket, 'close' | 'terminate' | 'readyState'> & {
  on: EventEmitter['on'];
  send(data: WebSocket.Data): void;
};
type SocketOptions = WebSocket.ClientOptions & {lookup?: LookupFunction};
const FALLBACK_DELAY_MS = 250;

/** Only the configured backend gets an optional direct route. URL, Host, SNI and
 * certificate verification stay unchanged; a stale IP cannot disable DNS fallback. */
export function createStreamSocket(url: string, token: string, directAddress?: string): StreamSocket {
  const options: SocketOptions = {headers: {Authorization: `Bearer ${token}`}};
  if (typeof directAddress !== 'string' || !isIP(directAddress) || new URL(url).protocol !== 'wss:') {
    return new WebSocket(url, options);
  }
  return new RoutedSocket(url, options, directAddress);
}

class RoutedSocket extends EventEmitter {
  readyState: WebSocket['readyState'] = WebSocket.CONNECTING;
  private winner: WebSocket | null = null;
  private candidates = new Set<WebSocket>();
  private fallback: NodeJS.Timeout | null = null;
  private fallbackStarted = false;
  private closed = false;

  constructor(private url: string, private options: SocketOptions, address: string) {
    super();
    // Start DNS independently if the configured direct address is unavailable or slow.
    this.fallback = setTimeout(() => this.startFallback(), FALLBACK_DELAY_MS);
    this.open({...options, lookup: (_hostname, lookupOptions, callback) => {
      const family = isIP(address);
      if (lookupOptions.all) callback(null, [{address, family}]);
      else callback(null, address, family);
    }});
  }

  private startFallback(): void {
    if (this.closed || this.winner || this.fallbackStarted) return;
    this.fallbackStarted = true;
    this.clearTimer();
    this.open(this.options);
  }

  private clearTimer(): void {
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
  }

  private open(options: SocketOptions): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url, options);
    } catch (error) {
      // Defer so callers can attach error/close listeners before a synchronous failure.
      queueMicrotask(() => this.failed(error as Error));
      return;
    }
    this.candidates.add(socket);
    socket.on('open', () => {
      if (this.closed || this.winner) { socket.terminate(); return; }
      this.winner = socket;
      this.readyState = WebSocket.OPEN;
      this.clearTimer();
      for (const other of this.candidates) if (other !== socket) other.terminate();
      this.candidates.clear();
      this.candidates.add(socket);
      // Only the winner receives client_hello, session_start or any audio/AI request.
      this.emit('open');
    });
    socket.on('message', (data, binary) => {
      if (!this.closed && socket === this.winner) this.emit('message', data, binary);
    });
    socket.on('error', error => {
      if (this.closed) return;
      if (socket === this.winner) this.emit('error', error);
      else if (!this.winner) {
        this.candidates.delete(socket);
        this.failed(error);
      }
    });
    socket.on('close', (code, reason) => {
      this.candidates.delete(socket);
      if (this.closed) return;
      if (socket === this.winner) {
        this.closed = true;
        this.readyState = WebSocket.CLOSED;
        this.emit('close', code, reason);
      } else if (!this.winner) this.failed(new Error('音频连接建立失败'));
    });
  }

  private failed(error: Error): void {
    if (this.closed || this.winner) return;
    if (!this.fallbackStarted) this.startFallback();
    else if (!this.candidates.size) {
      this.closed = true;
      this.clearTimer();
      this.readyState = WebSocket.CLOSED;
      this.emit('error', error);
      this.emit('close', 1006, Buffer.alloc(0));
    }
  }

  send(data: WebSocket.Data): void {
    this.winner?.send(data);
  }

  close(code?: number, reason?: string | Buffer): void {
    if (this.winner) this.winner.close(code, reason);
    else this.terminate();
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.readyState = WebSocket.CLOSED;
    for (const socket of this.candidates) socket.terminate();
    this.candidates.clear();
    this.emit('close', 1006, Buffer.alloc(0));
  }
}

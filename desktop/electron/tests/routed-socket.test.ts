import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const sockets = vi.hoisted(() => [] as any[]);
vi.mock('ws', async () => {
  const {EventEmitter} = await import('node:events');
  class Socket extends EventEmitter {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
    readyState = 0;
    send = vi.fn(); close = vi.fn(); terminate = vi.fn();
    constructor(public url: string, public options: any) {super(); sockets.push(this);}
  }
  return {default: Socket};
});
import {createStreamSocket} from '../audio/routed-socket';
import {StreamClient} from '../audio/stream-client';
beforeEach(() => {vi.useFakeTimers(); sockets.length = 0;});
afterEach(() => vi.useRealTimers());
const url = 'wss://interview.example/api/ws/audio/stream';
const address = '203.0.113.10';

describe('realtime connection route selection', () => {
  it('preserves hostname, authentication and TLS defaults while resolving only the address', () => {
    const connection = createStreamSocket(url, 'test', address);
    const socket = sockets[0];
    expect(socket.url).toBe(url);
    expect(socket.options.headers).toEqual({Authorization: 'Bearer test'});
    expect(socket.options.rejectUnauthorized).toBeUndefined();
    expect(socket.options.checkServerIdentity).toBeUndefined();
    const callback = vi.fn();
    socket.options.lookup('interview.example', {all: true}, callback);
    expect(callback).toHaveBeenCalledWith(null, [{address, family: 4}]);
    socket.options.lookup('interview.example', {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, address, 4);
    connection.terminate();
  });

  it('uses the fast direct route without creating another connection', async () => {
    const client = new StreamClient();
    const connected = client.connect(url, 'test', address);
    sockets[0].emit('open');
    expect(sockets[0].send).toHaveBeenCalledOnce();
    sockets[0].emit('message', Buffer.from('{"type":"ready"}'), false);
    await connected;
    await vi.advanceTimersByTimeAsync(300);
    expect(sockets).toHaveLength(1);
    expect(client.isReady()).toBe(true);
    client.disconnect();
  });

  it('starts DNS after 250 ms and never sends audio or hello to the losing connection', async () => {
    const client = new StreamClient();
    const connected = client.connect(url, 'test', address);
    const direct = sockets[0];
    await vi.advanceTimersByTimeAsync(250);
    const dns = sockets[1];
    expect(dns.options.lookup).toBeUndefined();
    dns.emit('open');
    dns.emit('message', Buffer.from('{"type":"ready"}'), false);
    await connected;
    direct.emit('open'); // A late callback from a cancelled candidate.
    const partials: unknown[] = [];
    client.on('transcription', message => partials.push(message));
    direct.emit('message', Buffer.from('{"type":"transcription","text":"loser"}'), false);
    dns.emit('message', Buffer.from('{"type":"transcription","text":"即时","is_final":false}'), false);
    client.sendFrame(Buffer.from('synthetic'));
    expect(direct.send).not.toHaveBeenCalled();
    expect(direct.terminate).toHaveBeenCalled();
    expect(dns.send).toHaveBeenCalledTimes(2);
    expect(partials).toEqual([{type: 'transcription', text: '即时', is_final: false}]);
    client.disconnect();
  });

  it('falls back immediately after a certificate or direct-route failure', () => {
    const connection = createStreamSocket(url, 'test', address);
    const errors = vi.fn(); connection.on('error', errors);
    sockets[0].emit('error', new Error('CERT_HAS_EXPIRED'));
    expect(sockets).toHaveLength(2);
    sockets[0].emit('close', 1006, Buffer.alloc(0));
    sockets[1].emit('open');
    expect(errors).not.toHaveBeenCalled();
    expect(connection.readyState).toBe(1);
    connection.terminate();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports both failed routes only once and retains normal reconnect behavior', () => {
    const connection = createStreamSocket(url, 'test', address);
    const errors = vi.fn(), closed = vi.fn();
    connection.on('error', errors); connection.on('close', closed);
    sockets[0].emit('error', new Error('unreachable'));
    sockets[0].emit('close', 1006, Buffer.alloc(0));
    sockets[1].emit('error', new Error('DNS failed'));
    sockets[1].emit('close', 1006, Buffer.alloc(0));
    expect(errors).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels both candidates and timers when capture is stopped during connection', async () => {
    const client = new StreamClient();
    const result = client.connect(url, 'test', address).catch(error => error);
    await vi.advanceTimersByTimeAsync(250);
    client.disconnect();
    expect((await result).message).toBe('主动断开');
    expect(sockets).toHaveLength(2);
    for (const socket of sockets) {
      expect(socket.terminate).toHaveBeenCalled();
      socket.emit('open');
      expect(socket.send).not.toHaveBeenCalled();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, '', 'not-an-ip'])('retains normal DNS for unconfigured/invalid address %s', address => {
    const connection = createStreamSocket(url, 'test', address);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].options.lookup).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    connection.terminate();
  });

  it('does not reroute local development', () => {
    const connection = createStreamSocket('ws://127.0.0.1:8010/api/ws', 'test', address);
    expect(sockets[0].options.lookup).toBeUndefined();
    connection.terminate();
  });
});

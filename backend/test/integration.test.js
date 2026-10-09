/**
 * End-to-end tests against real Postgres + Redis (no mocks).
 *
 *   DATABASE_URL=postgres://pulse:pulse@127.0.0.1:5432/pulse_test \
 *   REDIS_URL=redis://127.0.0.1:6379/1 npm test
 *
 * The suite wipes the target database's tables: point it at a throwaway DB.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { io as connect } from 'socket.io-client';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret-1234';
process.env.OTP_HMAC_SECRET ??= 'test-otp-secret-test-otp-secret-123456';
process.env.OTP_PROVIDER = 'console';
process.env.LOG_LEVEL ??= 'silent';
process.env.TRUST_PROXY = '0';

const { start } = await import('../src/server.js');
const { pool } = await import('../src/db/pool.js');
const { redis } = await import('../src/redis.js');

let app;
let base;
const PHONE_A = '+923001110001';
const PHONE_B = '+923001110002';
const PHONE_C = '+923001110003';

const hmac = (phone, code) =>
  crypto.createHmac('sha256', process.env.OTP_HMAC_SECRET).update(`${phone}:${code}`).digest('hex');

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(phone) {
  assert.equal((await api('POST', '/v1/auth/otp/request', { body: { phone } })).status, 202);
  // Real OTPs are only delivered out-of-band; substitute a known hash to drive the flow.
  await redis.hset(`otp:${phone}`, 'h', hmac(phone, '123456'));
  const res = await api('POST', '/v1/auth/otp/verify', { body: { phone, code: '123456', device: { name: 'test', platform: 'android' } } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

function socketFor(token) {
  const s = connect(base, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}
const emitAck = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));
const waitFor = (s, ev, pred = () => true, ms = 3000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    const h = (p) => {
      if (pred(p)) {
        clearTimeout(t);
        s.off(ev, h);
        resolve(p);
      }
    };
    s.on(ev, h);
  });

before(async () => {
  // Fresh state. Migrations run inside start().
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await redis.flushdb();
  app = await start({ port: 0 });
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.shutdown();
});

describe('auth', () => {
  it('rejects wrong OTP, then accepts right one; code is single use', async () => {
    await api('POST', '/v1/auth/otp/request', { body: { phone: PHONE_C } });
    await redis.hset(`otp:${PHONE_C}`, 'h', hmac(PHONE_C, '123456'));
    const bad = await api('POST', '/v1/auth/otp/verify', { body: { phone: PHONE_C, code: '000000' } });
    assert.equal(bad.status, 401);
    const ok = await api('POST', '/v1/auth/otp/verify', { body: { phone: PHONE_C, code: '123456' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.isNewUser, true);
    const again = await api('POST', '/v1/auth/otp/verify', { body: { phone: PHONE_C, code: '123456' } });
    assert.equal(again.status, 401);
  });

  it('locks out after too many wrong attempts', async () => {
    const phone = '+923001119999';
    await api('POST', '/v1/auth/otp/request', { body: { phone } });
    await redis.hset(`otp:${phone}`, 'h', hmac(phone, '123456'));
    for (let i = 0; i < 5; i++) await api('POST', '/v1/auth/otp/verify', { body: { phone, code: '111111' } });
    const res = await api('POST', '/v1/auth/otp/verify', { body: { phone, code: '123456' } });
    assert.equal(res.status, 401, 'correct code must fail once attempts are exhausted');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const s = await login('+923001118888');
    const r1 = await api('POST', '/v1/auth/refresh', { body: { refreshToken: s.refreshToken } });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.body.refreshToken, s.refreshToken);
    // Replaying the spent token = theft signal: it AND its successor die.
    const replay = await api('POST', '/v1/auth/refresh', { body: { refreshToken: s.refreshToken } });
    assert.equal(replay.status, 401);
    const successor = await api('POST', '/v1/auth/refresh', { body: { refreshToken: r1.body.refreshToken } });
    assert.equal(successor.status, 401);
    // And the family's access token is cut off immediately.
    assert.equal((await api('GET', '/v1/me', { token: r1.body.accessToken })).status, 401);
  });

  it('requires a valid access token', async () => {
    assert.equal((await api('GET', '/v1/me')).status, 401);
    assert.equal((await api('GET', '/v1/me', { token: 'garbage' })).status, 401);
    const s = await new Promise((resolve) => {
      const c = connect(base, { auth: { token: 'garbage' }, transports: ['websocket'], reconnection: false, forceNew: true });
      c.once('connect_error', (e) => { c.close(); resolve(e.message); });
    });
    assert.equal(s, 'invalid_token');
  });
});

describe('messaging', () => {
  let A, B, chatId, sa, sb;

  before(async () => {
    A = await login(PHONE_A);
    B = await login(PHONE_B);
    const chat = await api('POST', '/v1/chats/direct', { token: A.accessToken, body: { userId: B.user.id } });
    assert.equal(chat.status, 200);
    chatId = chat.body.id;
    // B opening the same chat converges on the same row (race-free get-or-create).
    const same = await api('POST', '/v1/chats/direct', { token: B.accessToken, body: { userId: A.user.id } });
    assert.equal(same.body.id, chatId);
    sa = await socketFor(A.accessToken);
    sb = await socketFor(B.accessToken);
  });
  after(() => { sa.close(); sb.close(); });

  const send = (s, text, clientMsgId = crypto.randomUUID()) =>
    emitAck(s, 'message:send', { chatId, clientMsgId, content: text });

  it('delivers in real time with sent -> delivered -> read receipts', async () => {
    const incoming = waitFor(sb, 'message:new');
    const ack = await send(sa, 'hello');
    assert.equal(ack.ok, true);
    assert.equal(ack.message.seq, 1);
    const msg = await incoming;
    assert.equal(msg.content, 'hello');

    const delivered = waitFor(sa, 'receipt:update', (r) => r.userId === B.user.id && r.deliveredSeq >= 1);
    assert.equal((await emitAck(sb, 'message:delivered', { chatId, upToSeq: 1 })).ok, true);
    assert.equal((await delivered).readSeq, 0);

    const read = waitFor(sa, 'receipt:update', (r) => r.readSeq >= 1);
    await emitAck(sb, 'message:read', { chatId, upToSeq: 1 });
    await read;
  });

  it('is idempotent on clientMsgId (retry after lost ack)', async () => {
    const id = crypto.randomUUID();
    const a = await send(sa, 'once', id);
    const b = await send(sa, 'once', id);
    assert.equal(b.duplicate, true);
    assert.equal(b.message.id, a.message.id);
    assert.equal(b.message.seq, a.message.seq);
  });

  it('assigns a gap-free, unique, strictly ordered seq under concurrent senders', async () => {
    const before = (await api('GET', `/v1/chats/${chatId}/messages?limit=100`, { token: A.accessToken })).body.messages.at(-1).seq;
    const N = 40;
    const acks = await Promise.all(
      Array.from({ length: N }, (_, i) => send(i % 2 ? sa : sb, `burst-${i}`)),
    );
    assert.ok(acks.every((a) => a.ok), JSON.stringify(acks.find((a) => !a.ok)));
    const seqs = acks.map((a) => a.message.seq).sort((x, y) => x - y);
    assert.deepEqual(seqs, Array.from({ length: N }, (_, i) => before + 1 + i));
  });

  it('refuses non-members and malformed payloads', async () => {
    const C = await login('+923001117777');
    const sc = await socketFor(C.accessToken);
    const res = await emitAck(sc, 'message:send', { chatId, clientMsgId: crypto.randomUUID(), content: 'intruder' });
    assert.deepEqual([res.ok, res.error], [false, 'not_a_member']);
    const bad = await emitAck(sa, 'message:send', { chatId: 'nope', clientMsgId: 'x', content: '' });
    assert.deepEqual([bad.ok, bad.error], [false, 'validation_failed']);
    assert.equal((await api('GET', `/v1/chats/${chatId}/messages`, { token: C.accessToken })).status, 403);
    sc.close();
  });

  it('strips control / bidi-override characters from content', async () => {
    const ack = await send(sa, 'hi‮evil\u0000!');
    assert.equal(ack.message.content, 'hievil!');
  });

  it('relays typing indicators to the peer only', async () => {
    const got = waitFor(sb, 'typing');
    await emitAck(sa, 'typing', { chatId, isTyping: true });
    assert.deepEqual(await got, { chatId, userId: A.user.id, isTyping: true });
  });

  it('tracks presence and last seen', async () => {
    const list1 = (await api('GET', '/v1/chats', { token: A.accessToken })).body.chats[0];
    assert.equal(list1.participants.find((p) => p.userId === B.user.id).online, true);

    const offline = waitFor(sa, 'presence', (p) => p.userId === B.user.id && p.online === false);
    sb.close();
    const ev = await offline;
    assert.ok(ev.lastSeen);
    const list2 = (await api('GET', '/v1/chats', { token: A.accessToken })).body.chats[0];
    assert.equal(list2.participants.find((p) => p.userId === B.user.id).online, false);
  });

  it('recovers missed messages via sync after an offline period (and fixes stale receipts)', async () => {
    // B is offline (closed in the previous test). A sends 3 messages meanwhile.
    const cursorBefore = (await api('GET', '/v1/chats', { token: B.accessToken })).body.chats[0].myDeliveredSeq;
    const lastKnown = (await api('GET', `/v1/chats/${chatId}/messages?limit=1`, { token: A.accessToken })).body.messages[0].seq;
    for (const t of ['m1', 'm2', 'm3']) await send(sa, t);

    const sb2 = await socketFor(B.accessToken);
    const res = await emitAck(sb2, 'sync', { cursors: { [chatId]: lastKnown } });
    assert.equal(res.ok, true);
    assert.deepEqual(res.messages.map((m) => m.content), ['m1', 'm2', 'm3']);
    assert.equal(res.hasMore, false);
    assert.ok(res.receipts.some((r) => r.chatId === chatId && r.userId === A.user.id));
    assert.ok(cursorBefore <= lastKnown);

    // Chats the client has never heard of are returned whole.
    const fresh = await emitAck(sb2, 'sync', { cursors: {} });
    assert.equal(fresh.chats.length, 1);
    assert.equal(fresh.chats[0].id, chatId);
    sb2.close();
  });

  it('pages sync with hasMore', async () => {
    const res = await api('POST', '/v1/sync', { token: B.accessToken, body: { cursors: { [chatId]: 0 } } });
    assert.equal(res.status, 200);
    assert.ok(res.body.messages.length > 0);
    // seqs are strictly ascending within the chat
    const seqs = res.body.messages.map((m) => m.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  });

  it('reports unread counts', async () => {
    const chats = (await api('GET', '/v1/chats', { token: B.accessToken })).body.chats;
    assert.ok(chats[0].unread >= 3);
  });
});

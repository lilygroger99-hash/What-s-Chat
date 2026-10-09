# Build order, reasoning, and gates

Build bottom-up along the **data path**, proving each layer with a test before stacking the next.
(Steps 1–7 below already exist in this repo; the gates tell you what to verify on *your* NAS.)

| # | Build | Why this order | Gate before moving on |
|---|---|---|---|
| 1 | Schema + migrations (`001_init.sql`) | Everything else encodes its invariants (seq uniqueness, idempotency key, direct_key). Changing it later hurts most | `npm run migrate` on an empty DB; re-run is a no-op |
| 2 | Auth: OTP + JWT + rotating refresh | Every other endpoint and the socket handshake depend on identity | Tests: wrong/expired/single-use OTP, lockout, rotation, reuse revocation |
| 3 | Message service (seq under row lock, idempotency) | The hardest correctness problem; do it before any UI hides bugs | 40-way concurrent send → unique, contiguous seqs; duplicate `clientMsgId` returns original |
| 4 | Socket layer (send, receipts, typing, presence) | Thin shell over step 3; handlers register synchronously (no await before `socket.on`) | Two clients: send → new → delivered → read ticks; non-member rejected |
| 5 | Sync / reconnect | Needed before the client, because the client's recovery logic is just "call sync" | Offline client misses 3 messages → sync returns exactly those, in order |
| 6 | Deploy to NAS (compose, nginx, DSM proxy, TLS) | Test over the **real network path** (WSS through DSM → nginx → app) early; proxy timeouts and header issues surface here, not in app code | `curl https://chat…/healthz`; a WS client stays connected > 5 min idle |
| 7 | Mobile data layer: SQLite repo + outbox | The UI reads only from it; get offline semantics right before pixels | Airplane-mode send queues, reconnect flushes once, no duplicates |
| 8 | Mobile engine (socket, sync, receipts, typing) | Mirrors backend gates from the client side | Kill the app mid-send, relaunch: message arrives exactly once |
| 9 | Screens, then push | Push last: it depends on a stable chat model and on Firebase setup | Real phone, screen off for 10 min, message → notification → tap opens the chat |

## Phase 1 exit checklist (all must be true before Phase 2)
- [ ] 14/14 backend integration tests green in CI against real Postgres + Redis
- [ ] WSS works from mobile data (not only home Wi-Fi) through the public hostname
- [ ] 24 h soak: ≥ 5 phones connected, no memory growth in `pulse-app` (`docker stats`), no
      unbounded Redis keys (`redis-cli --scan | wc -l` stable)
- [ ] Airplane-mode test: 20 queued messages arrive once, in order, ticks correct on both ends
- [ ] Token expiry test: leave the app open > 15 min → no logout, no missed messages
- [ ] Stolen-token drill: replay an old refresh token → that device is logged out
- [ ] Kill the app container mid-traffic → clients reconnect & sync with no loss
- [ ] Power-cut drill (or `docker kill db`): after restart, acknowledged messages are present
- [ ] Nightly `pg_dump` exists **and** one restore has been tested
- [ ] Only TCP 443 forwarded; DSM admin not reachable from WAN (check with an external port scan)
- [ ] OTP provider works with a real SMS/email path; per-phone/IP limits observed
- [ ] Crash-free sessions on at least two Android versions/devices

## Phase 2 order (and why)
1. **Decide the E2E device model first (design only).** Single device per account vs multi-device
   changes the key hierarchy, group fan-out and sync. It's cheap to decide now and very expensive to
   retrofit after groups/media exist. Also decide what the server may still see (metadata, sizes).
2. **Groups** — schema already supports N members and roles; add create/add/remove/promote, system
   messages, membership-cache invalidation (`invalidateMembers`), and group-aware ticks (already min-over-members).
3. **Media** — MinIO overlay, presigned PUT/GET (never public URLs), client-side compression,
   thumbnail generation, size/MIME allow-list, virus/size limits, upload resumption on flaky links.
4. **Voice messages** — recording → media pipeline (step 3) with waveform metadata.
5. **Reactions, replies, forwarding** — `reply_to` exists; reactions get their own table keyed by (message, user).
6. **E2E encryption** — apply per the model chosen in step 1; messages become ciphertext envelopes,
   so server-side search/previews/push content vanish by design. Add key verification (safety numbers).
7. **WebRTC calls** — signalling over the socket, coturn with ephemeral credentials; test on
   cellular↔Wi-Fi pairs, because ~15–30 % of real calls need the TURN relay.
8. **Stories** — expiring media with 24 h TTL job and per-viewer receipts.

### Phase 2 start criteria
Phase 1 checklist complete **and** you have written down: expected user count, media retention
policy, your E2E device model, and your upstream bandwidth measurement (speedtest upload × 0.7 is
your honest budget for media + calls).

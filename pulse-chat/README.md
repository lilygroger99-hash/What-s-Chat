# Pulse Chat

Self-hosted WhatsApp-style messenger. **Phase 1**: phone+OTP login, real-time 1-to-1 text chat,
sent/delivered/read ticks, typing, online/last-seen, offline queue, push doorbell.

```
backend/   Node 22 · Express 5 · Socket.io · PostgreSQL · Redis    (14 integration tests)
mobile/    React Native · Expo (dev client) · SQLite · TypeScript
deploy/    docker-compose.yml (Synology Container Manager) · nginx · phase-2 overlay
docs/      ARCHITECTURE · API · SYNOLOGY · BUILD_ORDER
.github/   workflow that builds the Android APK
```

## Run locally (backend)
```bash
cd backend && npm install
cp .env.example .env          # edit if needed
# needs Postgres 14+ and Redis 7 running locally
npm run migrate && npm run dev          # OTP codes are printed in the log (console provider)
DATABASE_URL=postgres://pulse:pulse@127.0.0.1:5432/pulse_test REDIS_URL=redis://127.0.0.1:6379/1 npm test
```

## Build the APK
Push this repo to GitHub, set repository **variable** `API_URL=https://chat.your-domain.example`,
run the *Build Android APK* workflow, download the `pulse-apk` artifact. Local dev:
```bash
cd mobile && npm install && npx expo install --fix   # aligns versions to your SDK
API_URL=http://<LAN-IP>:8080 ALLOW_CLEARTEXT=1 npx expo run:android
```
Change `android.package` in `mobile/app.config.ts` before you publish anywhere.

## Deploy
`docs/SYNOLOGY.md`. Design rationale and answers to ordering / reconnect / scaling / security /
exposure: `docs/ARCHITECTURE.md`. Build order and the Phase-2 gate: `docs/BUILD_ORDER.md`.

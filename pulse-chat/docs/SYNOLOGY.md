# Deploying on Synology (DSM 7.2+, Container Manager)

## 0. Preconditions
* Check for **CGNAT** first (see ARCHITECTURE §5.5). If your router WAN IP ≠ your public IP you
  cannot accept inbound connections and need a VPS/WireGuard front-end.
* A domain or Synology DDNS name pointing at your public IP.
* RAM: ≥ 2 GB free for the stack (Postgres 1 GB cap, app 768 MB, Redis 320 MB, nginx 128 MB).

## 1. Put the project on the NAS
1. File Station → create shared folder `docker` (if absent) → folder `pulse`.
2. Upload the contents of this repo's `backend/` and `deploy/` so you have
   `/volume1/docker/pulse/backend/…` and `/volume1/docker/pulse/deploy/…`.
3. In `deploy/`: copy `.env.example` → `.env` and fill it in. Generate secrets with
   `openssl rand -base64 48` (any machine). Set `DATA_DIR=/volume1/docker/pulse/data`.
4. Btrfs volumes: for the Postgres data directory, create it empty and disable copy-on-write
   (`chattr +C /volume1/docker/pulse/data/postgres` over SSH) before first start; it reduces
   write amplification for databases.

## 2. Create the project
Container Manager → **Project → Create** → path `/volume1/docker/pulse/deploy`, source: existing
`docker-compose.yml` → **Build** and start. First start builds the backend image and runs
migrations automatically (advisory-locked). Check **Container → pulse-app-1 → Log** for
`pulse backend listening`, and that all four containers are *healthy*.

Local check from SSH: `curl -s http://127.0.0.1:8080/healthz` → `{"ok":true}`.

## 3. Reverse proxy + TLS
1. Control Panel → Security → **Certificate** → Add → *Get a certificate from Let's Encrypt* for
   `chat.example.com` (needs port 80 reachable once, or use DNS-01 via your DNS provider).
2. Control Panel → Login Portal → **Advanced → Reverse Proxy → Create**
   * Source: HTTPS, `chat.example.com`, port 443
   * Destination: HTTP, `localhost`, port `8080`
   * *Custom Header* tab → **Create → WebSocket** (adds Upgrade/Connection headers)
   * *Advanced*: proxy read/send timeout ≥ 120 s
3. Certificate tab (Security → Certificate → Settings): assign the Let's Encrypt cert to that rule.

## 4. Network exposure
* Router: forward **TCP 443 → NAS:443** only. No other forwards.
* DSM Firewall (Control Panel → Security → Firewall): allow 443 from WAN (or your countries),
  allow 5000/5001/22 from LAN subnets only, deny all else. Enable Auto Block (5 failures / 10 min).
* Accounts: disable `admin`/`guest`, enable 2-step verification, auto-install critical updates.
* Do **not** publish 5432/6379/3000. The compose file already keeps them internal.

## 5. SMS / OTP delivery
Set `OTP_PROVIDER=http` and point `OTP_HTTP_URL` at your gateway (the backend POSTs
`{to, message}` with a bearer token — adapt `services/otp.js` if your provider differs), or
`OTP_PROVIDER=smtp` + `SMTP_URL` for email codes (proves the *email*, not the phone — fine for a
private group, not for open sign-up). Build the app with `OTP_VIA_EMAIL=1` for the email variant.

## 6. Push (optional, recommended)
1. Create a Firebase project (used only as a transport), add an Android app with package
   `com.pulsechat.app` (change it first in `mobile/app.config.ts`), download `google-services.json`.
2. Generate a service-account key; upload it to the NAS (e.g. `/volume1/docker/pulse/secrets/fcm.json`),
   mount it into the `app` service and set `PUSH_ENABLED=true`, `FCM_SERVICE_ACCOUNT_PATH=/run/secrets/fcm.json`.
3. For the APK build: base64 `google-services.json` into the GitHub secret `GOOGLE_SERVICES_JSON_B64`.
Without push, messages arrive while the app process is alive; Android will eventually freeze a
backgrounded app, so push is what makes background delivery reliable.

## 7. Backups & operations
* Nightly `pg_dump`: Task Scheduler → user-defined script
  `docker exec pulse-db-1 pg_dump -U pulse -Fc pulse > /volume1/backup/pulse-$(date +%F).dump`
  (keep 14, copy off-site). Restore test: `pg_restore -d` into a scratch DB.
* Updates: pull code → Project → **Build** → restart. Migrations are forward-only SQL files in
  `backend/src/db/migrations/`; never edit an applied file, add a new numbered one.
* Logs rotate at 10 MB × 5 per container.
* UPS strongly recommended; set DSM to shut down cleanly on low battery.

## 8. Phase 2: TURN for calls (preview)
Use `docker-compose.phase2.yml`. coturn needs direct UDP reachability: forward 3478 (UDP+TCP),
5349 (TCP) and the small relay range 49160–49200 (UDP) to the NAS; it cannot go through the DSM
reverse proxy. Use the Let's Encrypt cert for TLS, `--use-auth-secret` with credentials minted by
the backend, and keep the `--denied-peer-ip` rules so relays can't reach your LAN. CGNAT makes
TURN impossible without a VPS.

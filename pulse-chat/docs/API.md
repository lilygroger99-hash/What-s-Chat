# API reference (Phase 1)

Base: `https://<your-domain>/v1`. JSON in/out. Errors: `{ "error": { "code": "...", "message": "..." } }`.
Authenticated routes need `Authorization: Bearer <accessToken>`. Rate-limited responses are `429`
with `Retry-After`.

| Method & path | Auth | Body / query | Response |
|---|---|---|---|
| `POST /auth/otp/request` | – | `{ phone: "+923001234567", email? }` | `202 { ok, expiresIn }` (same for unknown numbers) |
| `POST /auth/otp/verify` | – | `{ phone, code, device?: {name, platform} }` | `{ user, isNewUser, accessToken, refreshToken, expiresIn }` · `401 invalid_code / too_many_attempts` |
| `POST /auth/refresh` | – | `{ refreshToken }` | new token pair (old refresh token is now spent) · `401 refresh_token_reused` revokes the session |
| `POST /auth/logout` | ✓ | `{ refreshToken }` | `204` |
| `GET /me` · `PATCH /me` | ✓ | `{ name?, about? }` | `User` |
| `POST /users/lookup` | ✓ | `{ phones: [E.164 × ≤200] }` | `{ users: User[] }` (20 calls/h) |
| `GET /chats` | ✓ | – | `{ chats: Chat[] }` with participants, cursors, unread, online, lastSeen |
| `POST /chats/direct` | ✓ | `{ userId }` | `Chat` (get-or-create, race-free) |
| `GET /chats/:id/messages` | ✓ | `?beforeSeq=&afterSeq=&limit≤100` | `{ messages }` ascending by seq |
| `POST /sync` | ✓ | `{ cursors: { chatId: seq } }` | `{ messages, chats, receipts, hasMore }` (same as socket `sync`) |
| `PUT /devices/push-token` · `DELETE …` | ✓ | `{ token, platform:'android' }` | `204` |
| `GET /healthz` | – | – | `{ ok }` · `503` if Postgres/Redis down |

WebSocket events: see `ARCHITECTURE.md` §4.

## Planned for Phase 2 (not implemented)
`POST /chats/group`, `PATCH /chats/:id/participants` (roles), `POST /media/upload-url` (presigned
PUT to MinIO) + `GET /media/:id` (short-lived signed URL), `POST /calls/turn-credentials`,
socket events `call:offer|answer|ice|end`, `reaction:add|remove`, `message:forward`, stories endpoints.

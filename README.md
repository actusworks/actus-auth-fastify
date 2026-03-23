# Actus Auth Fastify

A self-contained Fastify plugin that drops into any server with a single `register` call.  
Handles user registration, login, token refresh, and machine-to-machine API key authentication — backed by SQLite and signed JWTs.

## Features

- **Zero boilerplate** — register the plugin, everything works
- **JWT authentication** — short-lived access tokens + long-lived refresh tokens
- **API key authentication** — static keys for machine-to-machine access via `X-API-Key` header
- **SQLite storage** — via `better-sqlite3`, no separate DB process needed
- **bcrypt password hashing** — cost factor 12
- **Protected route prefix** — all routes under `/v1` (configurable) require a valid JWT or API key automatically
- **Invite-only registration** — optionally gate signups behind a secret code
- **Programmatic user creation** — `fastify.auth.register(...)` for server-side seeding
- **Role support** — `role` is embedded in access tokens and API key records, readable as `req.user.role`

---

## Installation

```bash
npm install actus-auth-fastify
```

> **Peer dependency:** requires `fastify >= 4.0.0`

---

## Quick Start

```js
import Fastify    from 'fastify';
import actusAuth from 'actus-auth-fastify';

const fastify = Fastify({ logger: true });

await fastify.register(actusAuth, {
  jwtSecret: process.env.JWT_SECRET,   // required
});

fastify.get('/v1/profile', async (req) => {
  return { user: req.user };           // req.user = { id, role }
});

await fastify.listen({ port: 3000, host: '0.0.0.0' });
```

All routes under `/v1` are now protected — they require either a valid JWT (`Authorization: Bearer <token>`) or a valid API key (`X-API-Key: <key>`). The auth endpoints (`/auth/register`, `/auth/login`, `/auth/refresh`) are public automatically.

---

## Options

Pass options as the second argument to `fastify.register()`.

| Option | Type | Default | Description |
|---|---|---|---|
| `jwtSecret` | `string` | **required** | Secret used to sign and verify JWTs. Use a long random string (≥ 32 chars). |
| `dbPath` | `string` | `'./auth.db'` | Path to the SQLite database file. Created automatically if it doesn't exist. |
| `accessTokenExpiry` | `string` | `'15m'` | Expiry for access tokens. Uses [ms](https://github.com/vercel/ms) format. |
| `refreshTokenExpiry` | `string` | `'90d'` | Expiry for refresh tokens. |
| `routePrefix` | `string` | `'/auth'` | URL prefix for all auth endpoints. |
| `protectedPrefix` | `string` | `'/v1'` | Routes starting with this prefix require a valid JWT or API key. |
| `inviteCode` | `string \| null` | `null` | If set, `POST /auth/register` requires a matching `inviteCode` in the body. |
| `publicRoutes` | `string[]` | `[]` | Additional URL prefixes to exclude from JWT/API key verification. |
| `adminPassword` | `string \| undefined` | `undefined` | If set, an `admin` account is created automatically on startup (see [Auto-seed admin](#auto-seed-admin)). Falls back to `process.env.ADMIN_PASSWORD` if not passed directly. |

### Generate a strong JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Full options example

```js
await fastify.register(authPlugin, {
  jwtSecret:          process.env.JWT_SECRET,
  dbPath:             './data/users.db',
  accessTokenExpiry:  '15m',
  refreshTokenExpiry: '90d',
  routePrefix:        '/auth',
  protectedPrefix:    '/v1',
  inviteCode:         process.env.INVITE_CODE,  // omit for open registration
  publicRoutes:       ['/v1/public'],
  adminPassword:      process.env.ADMIN_PASSWORD, // omit if not needed
});
```

---

## HTTP API

### `POST /auth/register`

Create a new user account.

**Body**
```json
{
  "username": "alice",
  "password": "hunter2",
  "email": "alice@example.com",
  "inviteCode": "secret"
}
```
`email` and `inviteCode` are optional (unless `inviteCode` option is set on the plugin).

**Responses**

| Status | Body | Reason |
|---|---|---|
| `201` | `{ "ok": true }` | User created |
| `403` | `{ "error": "Invalid invite code" }` | Wrong or missing invite code |
| `409` | `{ "error": "Username already taken" }` | Duplicate username |

---

### `POST /auth/login`

Authenticate and receive tokens.

**Body**
```json
{ "username": "alice", "password": "hunter2" }
```

**Response `200`**
```json
{
  "accessToken":  "eyJ...",
  "refreshToken": "eyJ..."
}
```

| Status | Body | Reason |
|---|---|---|
| `200` | `{ accessToken, refreshToken }` | Login successful |
| `401` | `{ "error": "Invalid credentials" }` | Wrong username or password |

---

### `POST /auth/refresh`

Exchange a refresh token for a new access token.

**Body**
```json
{ "refreshToken": "eyJ..." }
```

**Response `200`**
```json
{ "accessToken": "eyJ..." }
```

| Status | Body | Reason |
|---|---|---|
| `200` | `{ accessToken }` | Token refreshed |
| `401` | `{ "error": "Invalid refresh token" }` | Expired or tampered token |
| `401` | `{ "error": "User not found" }` | User was deleted after token was issued |

---

### `POST /auth/api-keys` _(admin only)_

Create a new API key for machine-to-machine access. The `key` value in the response is shown **once** — store it securely, it cannot be retrieved again.

Requires a valid admin JWT in the `Authorization: Bearer` header.

**Body**
```json
{ "name": "my-worker", "role": "service" }
```
`role` defaults to `"service"` if omitted.

**Response `201`**
```json
{
  "id":   1,
  "name": "my-worker",
  "role": "service",
  "key":  "ak_a1b2c3..."
}
```

| Status | Body | Reason |
|---|---|---|
| `201` | `{ id, name, role, key }` | Key created |
| `400` | `{ "error": "name is required" }` | Missing `name` field |
| `401` | `{ "error": "Unauthorized" }` | Missing or invalid JWT |
| `403` | `{ "error": "Forbidden" }` | Authenticated user is not an admin |

---

### `GET /auth/api-keys` _(admin only)_

List all active API keys. The raw key value is **never** returned — only metadata.

Requires a valid admin JWT in the `Authorization: Bearer` header.

**Response `200`**
```json
[
  { "id": 1, "name": "my-worker", "role": "service", "created": 1700000000 },
  { "id": 2, "name": "ci-bot",    "role": "service", "created": 1700001000 }
]
```

| Status | Body | Reason |
|---|---|---|
| `200` | `[{ id, name, role, created }]` | List of keys |
| `401` | `{ "error": "Unauthorized" }` | Missing or invalid JWT |
| `403` | `{ "error": "Forbidden" }` | Authenticated user is not an admin |

---

### `DELETE /auth/api-keys/:id` _(admin only)_

Revoke an API key by its ID. The key is immediately invalidated.

Requires a valid admin JWT in the `Authorization: Bearer` header.

**Response `200`**
```json
{ "ok": true }
```

| Status | Body | Reason |
|---|---|---|
| `200` | `{ "ok": true }` | Key revoked |
| `401` | `{ "error": "Unauthorized" }` | Missing or invalid JWT |
| `403` | `{ "error": "Forbidden" }` | Authenticated user is not an admin |

---

### Protected routes

Any route registered under `protectedPrefix` (default `/v1`) automatically requires either a valid JWT **or** a valid API key.

#### Option A — JWT (human users)

```
Authorization: Bearer <accessToken>
```

#### Option B — API key (machine-to-machine)

```
X-API-Key: ak_a1b2c3...
```

When a request is authenticated, `req.user` is populated:

```js
fastify.get('/v1/me', async (req) => {
  // JWT:     req.user = { id: 1, role: 'user',    iat: ..., exp: ... }
  // API key: req.user = { id: 1, role: 'service', type: 'apikey' }
  return req.user;
});
```

You can distinguish between the two by checking `req.user.type === 'apikey'`.

---

## API Key Example Usage

### 1. Log in as admin and create a key

```js
// Step 1 — authenticate as admin
const loginRes = await fetch('/auth/login', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD }),
});
const { accessToken } = await loginRes.json();

// Step 2 — create an API key
const createRes = await fetch('/auth/api-keys', {
  method:  'POST',
  headers: {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ name: 'my-worker', role: 'service' }),
});
const { id, key } = await createRes.json();
// key = "ak_a1b2c3..."  — save this now, it won't be shown again
console.log('API key:', key);
```

### 2. Use the key in a protected request

```js
const res = await fetch('/v1/data', {
  headers: { 'X-API-Key': 'ak_a1b2c3...' },
});
const data = await res.json();
```

### 3. List active keys

```js
const listRes = await fetch('/auth/api-keys', {
  headers: { 'Authorization': `Bearer ${accessToken}` },
});
const keys = await listRes.json();
// [{ id, name, role, created }, ...]
```

### 4. Revoke a key

```js
await fetch(`/auth/api-keys/${id}`, {
  method:  'DELETE',
  headers: { 'Authorization': `Bearer ${accessToken}` },
});
```

### 5. Server-side key creation (no HTTP request)

```js
// fastify.auth.createApiKey is available after plugin registration
const { id, key } = fastify.auth.createApiKey({ name: 'ci-bot', role: 'service' });
console.log('Store this key securely:', key);
```

### 6. Server-side key revocation

```js
fastify.auth.revokeApiKey(id);
```

### 7. Role-based access inside a protected route

```js
fastify.get('/v1/admin/data', async (req, reply) => {
  if (req.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden' });
  }
  return { secret: 'admin-only data' };
});
```

---

## Server-Side Usage

### Auto-seed admin

Pass `adminPassword` (or set the `ADMIN_PASSWORD` environment variable) and the plugin will automatically create an `admin` account when the server starts. If the account already exists the step is silently skipped.

`opts.adminPassword` takes precedence over `process.env.ADMIN_PASSWORD`.

```js
// Option A — via plugin option
await fastify.register(authPlugin, {
  jwtSecret:     process.env.JWT_SECRET,
  adminPassword: process.env.ADMIN_PASSWORD,
});

// Option B — via environment variable only (no extra option needed)
// set ADMIN_PASSWORD=secret in your environment, then:
await fastify.register(authPlugin, {
  jwtSecret: process.env.JWT_SECRET,
});
```

The account is seeded inside Fastify's `onReady` hook, so it runs after the plugin is fully initialised but before the server accepts requests.

### Seeding users programmatically

`fastify.auth.register()` creates a user programmatically, bypassing the HTTP route and invite code check.

```js
try {
  await fastify.auth.register({
    username: 'alice',
    password: 'hunter2',
    role:     'user',
  });
} catch (err) {
  if (err.code !== 'USERNAME_TAKEN') throw err;
}
```

### `fastify.auth.register(options)`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `username` | `string` | required | Unique username |
| `password` | `string` | required | Plain-text password — will be hashed |
| `email` | `string` | `null` | Optional email address |
| `role` | `string` | `'user'` | Role embedded in the JWT payload |

Returns `{ id, username, email, role }`.  
Throws with `err.code === 'USERNAME_TAKEN'` if the username is already registered.

### `fastify.auth.createApiKey(options)`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Human-readable label for the key |
| `role` | `string` | `'service'` | Role assigned to requests authenticated with this key |

Returns `{ id, name, role, key }`. The `key` value is shown **once** — store it securely.

### `fastify.auth.revokeApiKey(id)`

Revokes an API key by its numeric ID. The key is immediately invalidated for all subsequent requests.

### Accessing the database directly

The underlying `better-sqlite3` connection is exposed as `fastify.authDb` for advanced use cases.

```js
fastify.get('/v1/admin/users', async (req, reply) => {
  if (req.user.role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });
  return fastify.authDb.prepare('SELECT id, username, email, role, created FROM users').all();
});
```

---

## Client-Side Usage

Tokens are returned as JSON and stored in `localStorage`. Use this pattern for all authenticated API calls — it handles silent token refresh automatically.

### Login

```js
async function login(username, password) {
  const res = await fetch('/auth/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password }),
  });

  if (!res.ok) throw new Error('Login failed');

  const { accessToken, refreshToken } = await res.json();
  localStorage.setItem('access_token',  accessToken);
  localStorage.setItem('refresh_token', refreshToken);
}
```

### Authenticated fetch wrapper

```js
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
    },
  });

  // Token expired — try a silent refresh
  if (res.status === 401) {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return redirectToLogin();

    const refreshRes = await fetch('/auth/refresh', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refreshToken }),
    });

    if (!refreshRes.ok) return redirectToLogin();

    const { accessToken } = await refreshRes.json();
    localStorage.setItem('access_token', accessToken);

    // Retry the original request with the new token
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
      },
    });
  }

  return res;
}

function redirectToLogin() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  window.location.href = '/login';
}
```

### Register

```js
async function register(username, password, email, inviteCode) {
  const res = await fetch('/auth/register', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password, email, inviteCode }),
  });

  if (res.status === 409) throw new Error('Username already taken');
  if (res.status === 403) throw new Error('Invalid invite code');
  if (!res.ok) throw new Error('Registration failed');
}
```

### Logout

Logout is client-side only — clear the tokens and redirect.

```js
function logout() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  window.location.href = '/login';
}
```

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS users (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT    NOT NULL UNIQUE,
  email    TEXT,
  password TEXT    NOT NULL,              -- bcrypt hash, cost 12
  role     TEXT    NOT NULL DEFAULT 'user',
  created  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS api_keys (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT    NOT NULL UNIQUE,       -- SHA-256 hash of the raw key
  name     TEXT    NOT NULL,
  role     TEXT    NOT NULL DEFAULT 'service',
  created  INTEGER NOT NULL DEFAULT (unixepoch())
);
```

The database file is created automatically on first run. SQLite WAL mode is enabled for better read concurrency.  
Raw API key values are **never stored** — only a SHA-256 hash is persisted.

---

## Environment Variables

```env
# Required
JWT_SECRET=replace-with-a-long-random-string-minimum-32-chars

# Optional
INVITE_CODE=my-secret-invite-code
ADMIN_PASSWORD=my-admin-password
```

---

## Security Notes

- Passwords are hashed with **bcrypt at cost factor 12**. Plain-text passwords are never stored.
- **Access tokens** expire in 15 minutes — short-lived to limit the blast radius of a stolen token.
- **Refresh tokens** expire in 90 days. Treat them with the same security as a password.
- On every token refresh, the user is **re-fetched from the database** — deleted users and role changes take effect on the next refresh rather than waiting for the access token to expire.
- **API keys** are stored as SHA-256 hashes — the raw key is shown once at creation and never persisted. A compromised database does not expose usable keys.
- API keys do not expire on their own — revoke them explicitly via `DELETE /auth/api-keys/:id` or `fastify.auth.revokeApiKey(id)` when they are no longer needed.
- API key management endpoints (`POST/GET/DELETE /auth/api-keys`) require an admin JWT. You cannot manage keys using another API key.
- `inviteCode` prevents public signups. Use a long random string.
- The `role` claim lets downstream routes make authorization decisions via `req.user.role` without an extra database query.
- Auth routes are intentionally public — login and register must be reachable without a token.

---

## What is intentionally not included

- Email verification
- Password reset
- Rate limiting on login — add [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit) in your server
- Cookie-based auth — tokens are returned as JSON and stored client-side
- Multi-factor authentication
- API key expiry — revocation is manual by design

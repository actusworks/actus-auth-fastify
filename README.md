# Actus Auth Fastify

A self-contained Fastify plugin that drops into any server with a single `register` call.  
Handles user registration, login, and token refresh — backed by SQLite and signed JWTs.

## Features

- **Zero boilerplate** — register the plugin, everything works
- **JWT authentication** — short-lived access tokens + long-lived refresh tokens
- **SQLite storage** — via `better-sqlite3`, no separate DB process needed
- **bcrypt password hashing** — cost factor 12
- **Protected route prefix** — all routes under `/v1` (configurable) require a valid JWT automatically
- **Invite-only registration** — optionally gate signups behind a secret code
- **Programmatic user creation** — `fastify.auth.register(...)` for server-side seeding
- **Role support** — `role` is embedded in access tokens, readable as `req.user.role`

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

All routes under `/v1` are now JWT-protected. The auth endpoints (`/auth/register`, `/auth/login`, `/auth/refresh`) are public automatically.

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
| `protectedPrefix` | `string` | `'/v1'` | Routes starting with this prefix require a valid JWT. |
| `inviteCode` | `string \| null` | `null` | If set, `POST /auth/register` requires a matching `inviteCode` in the body. |
| `publicRoutes` | `string[]` | `[]` | Additional URL prefixes to exclude from JWT verification. |
| `adminPassword` | `string \| undefined` | `undefined` | If set, an `admin` account is created automatically on startup (see [Auto-seed admin](#auto-seed-admin)). Falls back to `process.env.ADMIN_PASSWORD` if not passed directly. |

### Generate a strong JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Full options example

```js
await fastify.register(authPlugin, {
  jwtSecret:        process.env.JWT_SECRET,
  dbPath:           './data/users.db',
  accessTokenExpiry:  '15m',
  refreshTokenExpiry: '90d',
  routePrefix:      '/auth',
  protectedPrefix:  '/v1',
  inviteCode:       process.env.INVITE_CODE,  // omit for open registration
  publicRoutes:     ['/v1/public'],
  adminPassword:    process.env.ADMIN_PASSWORD, // omit if not needed
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

### Protected routes

Any route registered under `protectedPrefix` (default `/v1`) automatically requires a valid JWT.  
Send the access token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

When verified, `req.user` is populated with the token payload:

```js
fastify.get('/v1/me', async (req) => {
  // req.user = { id: 1, role: 'user', iat: ..., exp: ... }
  return req.user;
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

`fastify.auth.register()` creates a user programmatically, bypassing the HTTP route and invite code check. Use this for any server-side user creation beyond the admin account.

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

### Accessing the database directly

The underlying `better-sqlite3` connection is exposed as `fastify.authDb` for advanced use cases.

```js
// List all users from another route
fastify.get('/v1/admin/users', async (req) => {
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
  // Attach current access token
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
```

The database file is created automatically on first run. SQLite WAL mode is enabled for better read concurrency.

---

## Environment Variables

```env
# Required
JWT_SECRET=replace-with-a-long-random-string-minimum-32-chars

# Optional
INVITE_CODE=my-secret-invite-code
```

---

## Security Notes

- Passwords are hashed with **bcrypt at cost factor 12**. Plain-text passwords are never stored.
- **Access tokens** expire in 15 minutes — short-lived to limit the blast radius of a stolen token.
- **Refresh tokens** expire in 90 days. Treat them with the same security as a password.
- On every token refresh, the user is **re-fetched from the database** — deleted users and role changes take effect on the next refresh rather than waiting for the access token to expire.
- `inviteCode` prevents public signups. Use a long random string.
- The `role` claim in the JWT lets downstream routes make authorization decisions via `req.user.role` without an extra database query.
- Auth routes (`/v1/auth/*`) are intentionally public — login and register must be reachable without a token.

---

## What is intentionally not included

- Email verification
- Password reset
- Rate limiting on login — add [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit) in your server
- Cookie-based auth — tokens are returned as JSON and stored client-side
- Multi-factor authentication

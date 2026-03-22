# Auth Module Plan for Fastify

## Goal

Build a self-contained, reusable auth module that can be dropped into any Fastify server with a single import. It must require zero modifications to work, expose all behaviour through an options object, and use SQLite as its database via `better-sqlite3`.

---

## Module Design

The module is a **Fastify plugin** (a function exported as `export default`). Fastify plugins are the standard way to bundle routes, hooks, and decorators into a reusable unit. Any Fastify server registers it with `fastify.register(authPlugin, options)`.

The module handles:
- User registration (optionally protected by an invite code)
- Login — returns a short-lived `accessToken` and a long-lived `refreshToken` as JSON
- Refresh — accepts a `refreshToken`, returns a new `accessToken`
- JWT verification hook — blocks unauthenticated access to all protected routes
- SQLite database creation and schema migration on startup

It does **not** handle cookies. Tokens are returned as JSON and the client stores them in `localStorage`. This keeps the module compatible with any frontend/client regardless of domain.

---

## File Structure

The published module should have this structure:

```
fastify-auth/
  index.js        ← main plugin entry point (the thing you import)
  db.js           ← SQLite connection and schema setup
  routes.js       ← /auth/register, /auth/login, /auth/refresh
  package.json
```

---

## Dependencies

```json
{
  "dependencies": {
    "bcrypt": "^5.1.1",
    "better-sqlite3": "^9.4.3",
    "@fastify/jwt": "^8.0.1"
  },
  "peerDependencies": {
    "fastify": ">=4.0.0"
  }
}
```

The consuming server does NOT need to install or register `@fastify/jwt` itself — the plugin registers it internally.

---

## Options Object

The plugin accepts an options object as the second argument to `fastify.register()`:

```js
fastify.register(authPlugin, {
  // REQUIRED
  jwtSecret: process.env.JWT_SECRET,          // string — secret for signing JWTs

  // OPTIONAL
  dbPath: './data/auth.db',                   // path to SQLite file (default: './auth.db')
  accessTokenExpiry: '15m',                   // JWT expiry for access token (default: '15m')
  refreshTokenExpiry: '90d',                  // JWT expiry for refresh token (default: '90d')
  routePrefix: '/auth',                       // prefix for all auth routes (default: '/auth')
  protectedPrefix: '/v1',                     // requests to this prefix require a valid JWT (default: '/v1')
  inviteCode: process.env.INVITE_CODE,        // if set, registration requires this code (default: null = open registration)
  publicRoutes: [],                           // additional route prefixes to exclude from JWT check (default: [])
})
```

---

## db.js

Uses `better-sqlite3` (synchronous SQLite driver — ideal for this use case, no async complexity).

```js
import Database from 'better-sqlite3';

export function openDb(dbPath = './auth.db') {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Create users table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT    NOT NULL UNIQUE,
      password TEXT    NOT NULL,
      role     TEXT    NOT NULL DEFAULT 'user',
      created  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  return db;
}
```

`openDb` is called once at plugin registration time and the `db` instance is passed to the routes. Do not call it multiple times — one connection per process.

---

## routes.js

Receives `fastify` and `db` and options, registers the three auth routes.

```js
import bcrypt from 'bcrypt';

export function registerAuthRoutes(fastify, db, opts) {
  const {
    accessTokenExpiry  = '15m',
    refreshTokenExpiry = '90d',
    routePrefix        = '/auth',
    inviteCode         = null,
  } = opts;


  // REGISTER
  // POST {routePrefix}/register
  // Body: { username, password, inviteCode? }
  fastify.post(`${routePrefix}/register`, async (req, reply) => {
    const { username, password, inviteCode: code } = req.body;

    // Invite code check (if configured)
    if (inviteCode && code !== inviteCode) {
      return reply.status(403).send({ error: 'Invalid invite code' });
    }

    // Duplicate username check
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return reply.status(409).send({ error: 'Username already taken' });
    }

    const hash = await bcrypt.hash(password, 12);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
    reply.status(201).send({ ok: true });
  });


  // LOGIN
  // POST {routePrefix}/login
  // Body: { username, password }
  // Returns: { accessToken, refreshToken }
  fastify.post(`${routePrefix}/login`, async (req, reply) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const accessToken  = fastify.jwt.sign({ id: user.id, role: user.role }, { expiresIn: accessTokenExpiry });
    const refreshToken = fastify.jwt.sign({ id: user.id }, { expiresIn: refreshTokenExpiry });

    reply.send({ accessToken, refreshToken });
  });


  // REFRESH
  // POST {routePrefix}/refresh
  // Body: { refreshToken }
  // Returns: { accessToken }
  fastify.post(`${routePrefix}/refresh`, async (req, reply) => {
    try {
      const payload      = fastify.jwt.verify(req.body.refreshToken);
      const user         = db.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.id);
      if (!user) return reply.status(401).send({ error: 'User not found' });

      const newAccessToken = fastify.jwt.sign({ id: user.id, role: user.role }, { expiresIn: accessTokenExpiry });
      reply.send({ accessToken: newAccessToken });
    } catch {
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }
  });
}
```

Note: On refresh, the user is re-fetched from the DB. This ensures that if a user is deleted or their role changes, the new token reflects that immediately instead of carrying stale data until the old token expires.

---

## index.js (the plugin entry point)

This is what the consuming server imports. It must:
1. Register `@fastify/jwt` with the provided secret
2. Open the SQLite DB
3. Register the auth routes
4. Add a `preHandler` hook to protect the configured prefix

```js
import fp         from 'fastify-plugin';
import jwt        from '@fastify/jwt';
import { openDb } from './db.js';
import { registerAuthRoutes } from './routes.js';

async function authPlugin(fastify, opts) {
  const {
    jwtSecret,
    dbPath           = './auth.db',
    protectedPrefix  = '/v1',
    routePrefix      = '/auth',
    publicRoutes     = [],
  } = opts;

  if (!jwtSecret) throw new Error('[fastify-auth] jwtSecret is required');

  // Register JWT
  await fastify.register(jwt, { secret: jwtSecret });

  // Open DB (synchronous, done once)
  const db = openDb(dbPath);

  // Register auth routes
  registerAuthRoutes(fastify, db, opts);

  // Protect all routes under protectedPrefix
  // Auth routes and any explicitly listed publicRoutes are excluded
  const authPrefix = `${protectedPrefix}${routePrefix}/`;

  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith(protectedPrefix)) return;
    if (request.url.startsWith(authPrefix)) return;
    if (publicRoutes.some(p => request.url.startsWith(p))) return;

    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Decorate fastify with db so other routes in the server can access it if needed
  fastify.decorate('authDb', db);
}

// fastify-plugin unwraps the plugin's encapsulation scope so that
// the jwt decorator and db decorator are visible to the whole server
export default fp(authPlugin);
```

`fastify-plugin` (npm: `fastify-plugin`) is required here. Without it, `fastify.jwt` and `fastify.authDb` would be scoped only inside the plugin and not visible to the rest of the server's routes. Add it to dependencies:

```json
"fastify-plugin": "^4.5.1"
```

---

## Usage in a Fastify Server

```js
// server.js
import Fastify    from 'fastify';
import authPlugin from './fastify-auth/index.js';   // or from 'fastify-auth' if published to npm

const fastify = Fastify({ logger: true });

await fastify.register(authPlugin, {
  jwtSecret:   process.env.JWT_SECRET,
  dbPath:      './data/users.db',
  inviteCode:  process.env.INVITE_CODE,    // omit to allow open registration
  protectedPrefix: '/v1',
  routePrefix:     '/auth',
});

// All routes registered after this point under /v1/ are protected automatically.
// /v1/auth/login, /v1/auth/register, /v1/auth/refresh are public.

fastify.get('/v1/profile', async (req, reply) => {
  // req.user is populated by jwtVerify — contains { id, role }
  return { user: req.user };
});

await fastify.listen({ port: 3000, host: '0.0.0.0' });
```

---

## Client-Side Usage (localStorage tokens)

```js
// Call once at login, store both tokens
async function login(username, password) {
  const { accessToken, refreshToken } = await fetch('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  }).then(r => r.json());

  localStorage.setItem('access_token', accessToken);
  localStorage.setItem('refresh_token', refreshToken);
}

// Use this wrapper for all authenticated API calls
async function apiFetch(url, options = {}) {
  let res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`
    }
  });

  if (res.status === 401) {
    // Silently try to refresh
    const refreshRes = await fetch('/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: localStorage.getItem('refresh_token') })
    });

    if (!refreshRes.ok) {
      // Refresh token expired — force re-login
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
      return;
    }

    const { accessToken } = await refreshRes.json();
    localStorage.setItem('access_token', accessToken);

    // Retry original request
    res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`
      }
    });
  }

  return res;
}

// Logout (client-side only — just clear tokens)
function logout() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  window.location.href = '/login';
}
```

---

## .env Variables

```env
JWT_SECRET=replace-with-a-long-random-string-minimum-32-chars
INVITE_CODE=my-secret-invite-code   # omit to allow open registration
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Security Notes

- Passwords are hashed with `bcrypt` at cost factor 12. Never store plain text.
- `accessToken` expires in 15 minutes. Even if stolen, damage is time-limited.
- `refreshToken` expires in 90 days. Treat it with the same care as a password.
- On refresh, the user is re-fetched from the DB — deleted users or role changes take effect immediately.
- `inviteCode` prevents random public signups. Use a long random string as the code.
- The `role` field in the users table is included in the JWT payload. Servers can use `req.user.role` for authorization checks beyond simple authentication.
- All `/v1/auth/*` routes are intentionally public (no JWT required) — login and register must be reachable without a token.

---

## What is NOT included (intentional scope limits)

- No email verification
- No password reset flow
- No rate limiting on login (consider adding `@fastify/rate-limit` in the consuming server)
- No cookie-based auth (by design — use the localStorage token approach described above; see `auth-with-cookies.js` in the reference codebase for the cookie variant)
- No multi-factor authentication

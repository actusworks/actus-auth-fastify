import { createUser, createApiKey, revokeApiKey } from './db.js';
import bcrypt   from 'bcrypt';

export function registerAuthRoutes(fastify, db, opts) {
	const {
		accessTokenExpiry  = '15m',
		refreshTokenExpiry = '90d',
		routePrefix        = '/auth',
		inviteCode         = null,
	} = opts;


	// MARK: REGISTER
	// POST {routePrefix}/register
	// Body: { username, password, email?, inviteCode? }
	fastify.post(`${routePrefix}/register`, async (req, reply) => {
		const { username, password, email, inviteCode: code } = req.body;

		// Invite code check (if configured)
		if (inviteCode && code !== inviteCode) {
			return reply.status(403).send({ error: 'Invalid invite code' });
		}

		try {
			await createUser(db, { username, password, email });
		} catch (err) {
			if (err.code === 'USERNAME_TAKEN') {
				return reply.status(409).send({ error: 'Username already taken' });
			}
			throw err;
		}

		reply.status(201).send({ ok: true });
	});



	// MARK: LOGIN
	// POST {routePrefix}/login
	// Body: { username, password }
	// Returns: { accessToken, refreshToken }
	fastify.post(`${routePrefix}/login`, async (req, reply) => {
		const { username, password } = req.body;
		const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

		if (!user || !(await bcrypt.compare(password, user.password))) {
			return reply.status(401).send({ error: 'Invalid credentials' });
		}

		const accessToken  = fastify.jwt.sign({ id: user.id, role: user.role, name: user.username }, { expiresIn: accessTokenExpiry });
		const refreshToken = fastify.jwt.sign({ id: user.id }, { expiresIn: refreshTokenExpiry });

		reply.send({ accessToken, refreshToken });
	});


	
	// MARK: REFRESH
	// POST {routePrefix}/refresh
	// Body: { refreshToken }
	// Returns: { accessToken }
	fastify.post(`${routePrefix}/refresh`, async (req, reply) => {
		try {
			const payload    = fastify.jwt.verify(req.body.refreshToken);
			const user       = db.prepare('SELECT id, role, username FROM users WHERE id = ?').get(payload.id);
			if (!user) return reply.status(401).send({ error: 'User not found' });

			const newAccessToken = fastify.jwt.sign({ id: user.id, role: user.role, name: user.username }, { expiresIn: accessTokenExpiry });
			reply.send({ accessToken: newAccessToken });
		} catch {
			return reply.status(401).send({ error: 'Invalid refresh token' });
		}
	});


	// MARK: API KEYS (admin only)
	// These routes live under the auth prefix so the main preHandler skips them;
	// each route performs its own JWT verification and admin role check.

	// Helper: require a valid JWT with role 'admin'
	async function requireAdmin(req, reply) {
		try { await req.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
		if (req.user?.role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });
	}

	// POST {routePrefix}/api-keys
	// Body: { name, role? }
	// Returns: { id, name, role, key }  — key is shown once, store it securely
	fastify.post(`${routePrefix}/api-keys`, async (req, reply) => {
		const stop = await requireAdmin(req, reply);
		if (stop !== undefined) return;

		const { name, role = 'service' } = req.body ?? {};
		if (!name) return reply.status(400).send({ error: 'name is required' });

		const result = createApiKey(db, { name, role });
		reply.status(201).send(result);
	});

	// GET {routePrefix}/api-keys
	// Returns: [{ id, name, role, created }, ...]
	fastify.get(`${routePrefix}/api-keys`, async (req, reply) => {
		const stop = await requireAdmin(req, reply);
		if (stop !== undefined) return;

		const keys = db.prepare('SELECT id, name, role, created FROM api_keys').all();
		reply.send(keys);
	});

	// DELETE {routePrefix}/api-keys/:id
	fastify.delete(`${routePrefix}/api-keys/:id`, async (req, reply) => {
		const stop = await requireAdmin(req, reply);
		if (stop !== undefined) return;

		revokeApiKey(db, req.params.id);
		reply.send({ ok: true });
	});
}

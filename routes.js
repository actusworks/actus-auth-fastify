import { createUser } from './db.js';
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

		const accessToken  = fastify.jwt.sign({ id: user.id, role: user.role }, { expiresIn: accessTokenExpiry });
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
			const user       = db.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.id);
			if (!user) return reply.status(401).send({ error: 'User not found' });

			const newAccessToken = fastify.jwt.sign({ id: user.id, role: user.role }, { expiresIn: accessTokenExpiry });
			reply.send({ accessToken: newAccessToken });
		} catch {
			return reply.status(401).send({ error: 'Invalid refresh token' });
		}
	});
}

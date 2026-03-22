import fp                     from 'fastify-plugin';
import jwt                    from '@fastify/jwt';
import { openDb, createUser } from './db.js';
import { registerAuthRoutes } from './routes.js';





async function authPlugin(fastify, opts) {
	const {
		jwtSecret,
		dbPath          = './auth.db',
		protectedPrefix = '/v1',
		routePrefix     = '/auth',
		publicRoutes    = [],
	} = opts;

	if (!jwtSecret) throw new Error('[actus-auth-fastify] jwtSecret is required');

	// Register JWT
	await fastify.register(jwt, { secret: jwtSecret });

	// Open DB (synchronous, done once)
	const db = openDb(dbPath);

	// Register auth routes
	registerAuthRoutes(fastify, db, opts);

	// Protect all routes under protectedPrefix.
	// Auth routes and any explicitly listed publicRoutes are excluded.
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

	// Decorate fastify with db so other routes in the server can access it if needed.
	// fastify.auth.register(opts) lets server-side code create users programmatically
	// without going through the HTTP route (bypasses invite code check by design).
	fastify.decorate('authDb', db);
	fastify.decorate('auth', {
		register: (opts) => createUser(db, opts),
	});
}


// fastify-plugin unwraps the plugin's encapsulation scope so that
// the jwt decorator and db decorator are visible to the whole server
export default fp(authPlugin);

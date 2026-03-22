









// MARK: SERVER
// -----------------------------------
// npm install actus-auth
// npm install --install-links E:\DEV\DEV\actus-auth


import Fastify    from 'fastify';
import actusAuth from 'actus-auth';

const fastify = Fastify({ logger: true });

await fastify.register(actusAuth, {
    jwtSecret: process.env.JWT_SECRET,
});

fastify.get('/v1/profile', async (req) => {
    return { user: req.user };
    // req.user = { id, role }
});

await fastify.listen({ port: 3000, host: '0.0.0.0' });



// Full options example
await fastify.register(actusAuth, {
    jwtSecret:        process.env.JWT_SECRET,
    dbPath:           './data/users.db',
    accessTokenExpiry:  '15m',
    refreshTokenExpiry: '90d',
    routePrefix:      '/auth',
    protectedPrefix:  '/v1',
    inviteCode:       process.env.INVITE_CODE,  // omit for open registration
    publicRoutes:     ['/v1/public'],
});


// Seeding an admin user on startup
try {
    await fastify.auth.register({
		username: 'admin',
		password: process.env.ADMIN_PASSWORD,
		role:     'admin',
    });
    fastify.log.info('Admin account created');
} catch (err) {
    if (err.code !== 'USERNAME_TAKEN') throw err;
    // already exists — no action needed
}



// Accessing the database directly
// example: List all users from another route
fastify.get('/v1/admin/users', async (req) => {
	if (req.user.role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });
	return fastify.authDb.prepare('SELECT id, username, email, role, created FROM users').all();
});
















// MARK: CLIENT
// -----------------------------------








// MARK: Login
// ----------------------
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



// MARK: Fetch
// ----------------------
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




// MARK: Register
// ----------------------
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


// MARK: Logout
// ----------------------
function logout() {
	localStorage.removeItem('access_token');
	localStorage.removeItem('refresh_token');
	window.location.href = '/login';
}
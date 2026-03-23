import Database from 'better-sqlite3';
import bcrypt   from 'bcrypt';
import crypto   from 'crypto';





export function openDb(dbPath = './auth.db') {
	const db = new Database(dbPath);

	// Enable WAL mode for better concurrent read performance
	db.pragma('journal_mode = WAL');

	
	// Create users table if it doesn't exist
	db.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id       INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT    NOT NULL UNIQUE,
			email    TEXT,
			password TEXT    NOT NULL,
			role     TEXT    NOT NULL DEFAULT 'user',
			created  INTEGER NOT NULL DEFAULT (unixepoch())
		)
	`);

	// Create api_keys table if it doesn't exist
	db.exec(`
		CREATE TABLE IF NOT EXISTS api_keys (
			id       INTEGER PRIMARY KEY AUTOINCREMENT,
			key_hash TEXT    NOT NULL UNIQUE,
			name     TEXT    NOT NULL,
			role     TEXT    NOT NULL DEFAULT 'service',
			created  INTEGER NOT NULL DEFAULT (unixepoch())
		)
	`);

	return db;
}







/**
 * Programmatically register a new user.
 * Throws an Error with a `code` property on validation failures:
 *   'USERNAME_TAKEN'  — username already exists
 * @param {import('better-sqlite3').Database} db
 * @param {{ username: string, password: string, email?: string, role?: string }} user
 * @returns {{ id: number, username: string, email: string|null, role: string }}
 */
export async function createUser(db, { username, password, email = null, role = 'user' }) {
		const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
		if (existing) {
			const err = new Error('Username already taken');
			err.code = 'USERNAME_TAKEN';
			throw err;
		}

		const hash = await bcrypt.hash(password, 12);
		const info = db.prepare(
			'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)'
		).run(username, email, hash, role);

		return { id: info.lastInsertRowid, username, email, role };
}


/**
 * Create a new API key for machine-to-machine access.
 * Returns the plain key once — store it securely, it cannot be retrieved again.
 * @param {import('better-sqlite3').Database} db
 * @param {{ name: string, role?: string }} opts
 * @returns {{ id: number, name: string, role: string, key: string }}
 */
export function createApiKey(db, { name, role = 'service' }) {
	const key  = 'ak_' + crypto.randomBytes(32).toString('hex');
	const hash = crypto.createHash('sha256').update(key).digest('hex');
	const info = db.prepare(
		'INSERT INTO api_keys (key_hash, name, role) VALUES (?, ?, ?)'
	).run(hash, name, role);
	return { id: info.lastInsertRowid, name, role, key };
}

/**
 * Verify an API key and return its record, or null if invalid.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {{ id: number, name: string, role: string } | null}
 */
export function verifyApiKey(db, key) {
	const hash = crypto.createHash('sha256').update(key).digest('hex');
	return db.prepare('SELECT id, name, role FROM api_keys WHERE key_hash = ?').get(hash) ?? null;
}

/**
 * Revoke an API key by its id.
 * @param {import('better-sqlite3').Database} db
 * @param {number|string} id
 */
export function revokeApiKey(db, id) {
	db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}

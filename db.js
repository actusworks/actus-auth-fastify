import Database from 'better-sqlite3';
import bcrypt   from 'bcrypt';





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

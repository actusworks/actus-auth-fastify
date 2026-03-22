/* ============================================================
   ACTUS AUTH — FRONTEND CLIENT
   All functions from example.js + UI wiring
   ============================================================ */

'use strict';


// ============================================================
// MARK: API HELPERS
// ============================================================

/**
 * Log in with username + password.
 * Stores accessToken and refreshToken in localStorage on success.
 */
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


/**
 * Authenticated fetch wrapper.
 * Automatically retries with a refreshed access token on 401.
 */
async function apiFetch(url, options = {}) {
	const res = await fetch(url, {
		...options,
		headers: {
			...options.headers,
			'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
		},
	});

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


/**
 * Register a new user account.
 */
async function register(username, password, email, inviteCode) {
	const res = await fetch('/auth/register', {
		method:  'POST',
		headers: { 'Content-Type': 'application/json' },
		body:    JSON.stringify({ username, password, email, inviteCode }),
	});

	if (res.status === 409) throw new Error('Username already taken');
	if (res.status === 403) throw new Error('Invalid invite code');
	if (!res.ok)             throw new Error('Registration failed');
}


/**
 * Clear tokens and redirect to the login page.
 */
function redirectToLogin() {
	localStorage.removeItem('access_token');
	localStorage.removeItem('refresh_token');
	window.location.href = '/login';
}


/**
 * Log out the current user.
 */
function logout() {
	localStorage.removeItem('access_token');
	localStorage.removeItem('refresh_token');
	window.location.href = '/login';
}


// ============================================================
// MARK: TOAST NOTIFICATIONS
// ============================================================

const TOAST_ICONS = {
	success: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`,
	error:   `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>`,
	info:    `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>`,
	warning: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
};

/**
 * Show a toast notification.
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} title
 * @param {string} [message]
 * @param {number} [duration=4000]
 */
function showToast(type = 'info', title, message = '', duration = 4000) {
	const container = document.getElementById('toastContainer');

	const toast = document.createElement('div');
	toast.className = `toast ${type}`;
	toast.innerHTML = `
		<div class="toast-icon">${TOAST_ICONS[type] ?? TOAST_ICONS.info}</div>
		<div class="toast-body">
			<div class="toast-title">${escapeHtml(title)}</div>
			${message ? `<div class="toast-msg">${escapeHtml(message)}</div>` : ''}
		</div>
		<div class="toast-progress" style="animation-duration:${duration}ms"></div>
	`;

	container.appendChild(toast);

	const remove = () => {
		toast.classList.add('leaving');
		toast.addEventListener('animationend', () => toast.remove(), { once: true });
	};

	const timer = setTimeout(remove, duration);
	toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}


// ============================================================
// MARK: PARTICLES BACKGROUND
// ============================================================

(function initParticles() {
	const canvas = document.getElementById('particles');
	if (!canvas) return;

	const ctx    = canvas.getContext('2d');
	let W, H, particles;

	const PARTICLE_COUNT = 70;
	const MAX_DIST       = 130;

	class Particle {
		constructor() { this.reset(true); }

		reset(initial = false) {
			this.x  = Math.random() * W;
			this.y  = initial ? Math.random() * H : H + 10;
			this.vx = (Math.random() - 0.5) * 0.35;
			this.vy = -(Math.random() * 0.5 + 0.15);
			this.r  = Math.random() * 1.8 + 0.6;
			this.alpha = Math.random() * 0.5 + 0.2;
		}

		update() {
			this.x += this.vx;
			this.y += this.vy;
			if (this.y < -10) this.reset();
		}

		draw() {
			ctx.beginPath();
			ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(167,139,250,${this.alpha})`;
			ctx.fill();
		}
	}

	function resize() {
		W = canvas.width  = window.innerWidth;
		H = canvas.height = window.innerHeight;
	}

	function drawConnections() {
		for (let i = 0; i < particles.length; i++) {
			for (let j = i + 1; j < particles.length; j++) {
				const dx   = particles[i].x - particles[j].x;
				const dy   = particles[i].y - particles[j].y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (dist < MAX_DIST) {
					const opacity = (1 - dist / MAX_DIST) * 0.18;
					ctx.beginPath();
					ctx.moveTo(particles[i].x, particles[i].y);
					ctx.lineTo(particles[j].x, particles[j].y);
					ctx.strokeStyle = `rgba(139,92,246,${opacity})`;
					ctx.lineWidth   = 0.8;
					ctx.stroke();
				}
			}
		}
	}

	function loop() {
		ctx.clearRect(0, 0, W, H);
		particles.forEach(p => { p.update(); p.draw(); });
		drawConnections();
		requestAnimationFrame(loop);
	}

	resize();
	particles = Array.from({ length: PARTICLE_COUNT }, () => new Particle());
	window.addEventListener('resize', resize);
	loop();
})();


// ============================================================
// MARK: TAB SWITCHING
// ============================================================

(function initTabs() {
	const tabs      = document.querySelectorAll('.tab');
	const forms     = document.querySelectorAll('.auth-form');
	const indicator = document.querySelector('.tab-indicator');

	function switchTab(name) {
		tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
		forms.forEach(f => {
			const active = f.id === `${name}Form`;
			f.classList.toggle('active', active);
			if (active) f.style.animation = 'none', requestAnimationFrame(() => {
				f.style.animation = '';
			});
		});
		indicator.classList.toggle('right', name === 'register');
	}

	tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

	// "Create one" / "Sign in" links inside forms
	document.querySelectorAll('[data-switch]').forEach(link => {
		link.addEventListener('click', e => { e.preventDefault(); switchTab(link.dataset.switch); });
	});
})();


// ============================================================
// MARK: PASSWORD TOGGLE
// ============================================================

document.querySelectorAll('.eye-btn').forEach(btn => {
	btn.addEventListener('click', () => {
		const input  = document.getElementById(btn.dataset.target);
		const isText = input.type === 'text';
		input.type   = isText ? 'password' : 'text';
		btn.querySelector('.eye-open').style.display  = isText ? ''     : 'none';
		btn.querySelector('.eye-closed').style.display = isText ? 'none' : '';
	});
});


// ============================================================
// MARK: PASSWORD STRENGTH METER
// ============================================================

(function initStrengthMeter() {
	const pwInput = document.getElementById('regPassword');
	const meter   = document.getElementById('strengthMeter');
	const fill    = document.getElementById('strengthFill');
	const label   = document.getElementById('strengthLabel');

	const LEVELS = [
		{ label: 'Too weak',  color: '#f87171', width: '20%' },
		{ label: 'Weak',      color: '#fb923c', width: '40%' },
		{ label: 'Fair',      color: '#fbbf24', width: '62%' },
		{ label: 'Strong',    color: '#34d399', width: '85%' },
		{ label: 'Very strong', color: '#06ffa5', width: '100%' },
	];

	function score(pw) {
		let s = 0;
		if (pw.length >= 8)  s++;
		if (pw.length >= 12) s++;
		if (/[A-Z]/.test(pw)) s++;
		if (/[0-9]/.test(pw)) s++;
		if (/[^A-Za-z0-9]/.test(pw)) s++;
		return Math.min(s, 4);
	}

	pwInput.addEventListener('input', () => {
		const pw  = pwInput.value;
		const vis = pw.length > 0;

		meter.classList.toggle('visible', vis);
		if (!vis) return;

		const lvl = LEVELS[score(pw)];
		fill.style.width      = lvl.width;
		fill.style.background = lvl.color;
		label.textContent     = lvl.label;
		label.style.color     = lvl.color;
	});
})();


// ============================================================
// MARK: BUTTON RIPPLE
// ============================================================

document.querySelectorAll('.btn-primary').forEach(btn => {
	btn.addEventListener('click', function(e) {
		const rect   = this.getBoundingClientRect();
		const ripple = document.createElement('span');
		const size   = Math.max(rect.width, rect.height);

		ripple.classList.add('ripple');
		ripple.style.cssText = `
			width:${size}px; height:${size}px;
			left:${e.clientX - rect.left - size/2}px;
			top:${e.clientY - rect.top  - size/2}px;
		`;
		this.appendChild(ripple);
		ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
	});
});


// ============================================================
// MARK: SET LOADING STATE
// ============================================================

function setLoading(btn, loading) {
	btn.disabled = loading;
	btn.classList.toggle('loading', loading);
	const loader = btn.querySelector('.btn-loader');
	if (loader) loader.hidden = !loading;
}


// ============================================================
// MARK: LOGIN FORM HANDLER
// ============================================================

document.getElementById('loginForm').addEventListener('submit', async function(e) {
	e.preventDefault();

	const username = document.getElementById('loginUsername').value.trim();
	const password = document.getElementById('loginPassword').value;
	const btn      = document.getElementById('loginBtn');

	if (!username || !password) {
		showToast('warning', 'Missing fields', 'Please enter your username and password.');
		return;
	}

	setLoading(btn, true);

	try {
		await login(username, password);
		showToast('success', 'Welcome back!', `Signed in as ${username}.`);
		// Redirect after a short delay so the user sees the toast
		setTimeout(() => { window.location.href = '/'; }, 1200);
	} catch (err) {
		showToast('error', 'Sign-in failed', err.message ?? 'Invalid username or password.');
	} finally {
		setLoading(btn, false);
	}
});


// ============================================================
// MARK: REGISTER FORM HANDLER
// ============================================================

document.getElementById('registerForm').addEventListener('submit', async function(e) {
	e.preventDefault();

	const username   = document.getElementById('regUsername').value.trim();
	const email      = document.getElementById('regEmail').value.trim() || undefined;
	const password   = document.getElementById('regPassword').value;
	const inviteCode = document.getElementById('regInvite').value.trim() || undefined;
	const btn        = document.getElementById('registerBtn');

	if (!username || !password) {
		showToast('warning', 'Missing fields', 'Username and password are required.');
		return;
	}

	if (username.length < 3) {
		showToast('warning', 'Username too short', 'Username must be at least 3 characters.');
		return;
	}

	if (password.length < 8) {
		showToast('warning', 'Password too short', 'Password must be at least 8 characters.');
		return;
	}

	setLoading(btn, true);

	try {
		await register(username, password, email, inviteCode);
		showToast('success', 'Account created!', 'You can now sign in with your credentials.');
		// Switch to login tab after success
		setTimeout(() => {
			document.querySelector('[data-tab="login"]').click();
			document.getElementById('loginUsername').value = username;
			document.getElementById('loginPassword').focus();
		}, 1400);
	} catch (err) {
		showToast('error', 'Registration failed', err.message ?? 'Something went wrong.');
	} finally {
		setLoading(btn, false);
	}
});

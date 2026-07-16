<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { api } from '$lib/api';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { children } = $props();

	type User = { id: number; username: string; role: string };

	let user = $state<User | null>(null);
	let loading = $state(true);
	let needsSetup = $state(false);

	const publicPaths = ['/setup', '/login'];

	onMount(async () => {
		const boot = await api<{ needsSetup: boolean }>('/api/bootstrap');
		needsSetup = boot.data?.needsSetup ?? false;
		const me = await api<{ user: User | null }>('/api/me');
		user = me.data?.user ?? null;
		loading = false;

		const path = page.url.pathname;
		if (needsSetup && path !== '/setup') {
			await goto('/setup');
			return;
		}
		if (!needsSetup && !user && !publicPaths.includes(path)) {
			await goto('/login');
			return;
		}
		if (user && (path === '/login' || path === '/setup')) {
			await goto('/');
		}
	});

	async function logout() {
		await api('/api/logout', { method: 'POST' });
		user = null;
		await goto('/login');
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
	<title>CottAssistant</title>
</svelte:head>

{#if loading}
	<div class="shell loading">Loading…</div>
{:else}
	<div class="shell">
		{#if user}
			<header class="top">
				<a class="brand" href="/">CottAssistant</a>
				<nav>
					<a href="/" class:active={page.url.pathname === '/'}>Chat</a>
					<a href="/crons" class:active={page.url.pathname === '/crons'}>Crons</a>
					<a href="/settings" class:active={page.url.pathname === '/settings'}>Settings</a>
					<a href="/discord" class:active={page.url.pathname === '/discord'}>Discord</a>
					<a href="/voice" class:active={page.url.pathname === '/voice'}>Voice</a>
					{#if user.role === 'admin'}
						<a href="/users" class:active={page.url.pathname === '/users'}>Users</a>
					{/if}
				</nav>
				<div class="user">
					<span>{user.username}</span>
					<button type="button" class="ghost" onclick={logout}>Log out</button>
				</div>
			</header>
		{/if}
		<main>
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.loading {
		align-items: center;
		justify-content: center;
		color: var(--muted);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.9rem 1.5rem;
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklab, var(--bg-elevated) 85%, transparent);
		backdrop-filter: blur(8px);
		position: sticky;
		top: 0;
		z-index: 10;
	}
	.brand {
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
		letter-spacing: -0.02em;
	}
	nav {
		display: flex;
		gap: 0.75rem;
		flex: 1;
	}
	nav a {
		color: var(--muted);
		text-decoration: none;
		padding: 0.35rem 0.55rem;
		border-radius: 6px;
	}
	nav a:hover,
	nav a.active {
		color: var(--text);
		background: var(--bg-elevated);
		text-decoration: none;
	}
	.user {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.ghost {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
		padding: 0.3rem 0.7rem;
		border-radius: 6px;
	}
	.ghost:hover {
		border-color: var(--muted);
	}
	main {
		flex: 1;
		padding: 1.5rem;
		max-width: 960px;
		width: 100%;
		margin: 0 auto;
	}
</style>

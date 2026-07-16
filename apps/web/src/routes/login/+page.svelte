<script lang="ts">
	import { api } from '$lib/api';
	import { goto } from '$app/navigation';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit() {
		busy = true;
		error = '';
		const res = await api('/api/login', {
			method: 'POST',
			body: JSON.stringify({ username, password })
		});
		busy = false;
		if (res.error) {
			error = res.error;
			return;
		}
		await goto('/');
		location.reload();
	}
</script>

<section class="auth">
	<h1>Sign in</h1>
	<p>CottAssistant WebUI — bound to 127.0.0.1</p>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void submit();
		}}
	>
		<label>
			Username
			<input bind:value={username} autocomplete="username" required />
		</label>
		<label>
			Password
			<input bind:value={password} type="password" autocomplete="current-password" required />
		</label>
		{#if error}<p class="err">{error}</p>{/if}
		<button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
	</form>
</section>

<style>
	.auth {
		max-width: 420px;
		margin: 3rem auto;
	}
	h1 {
		font-family: var(--font-display);
		margin-bottom: 0.35rem;
	}
	p {
		color: var(--muted);
	}
	form {
		display: grid;
		gap: 0.85rem;
		margin-top: 1.25rem;
	}
	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.9rem;
		color: var(--muted);
	}
	input {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.6rem 0.75rem;
		color: var(--text);
	}
	button {
		background: var(--accent);
		border: none;
		color: #04150c;
		font-weight: 600;
		padding: 0.65rem;
		border-radius: 8px;
	}
	.err {
		color: var(--danger);
	}
</style>

<script lang="ts">
	import { api } from '$lib/api';
	import { onMount } from 'svelte';

	type DiscordUser = { discordId: string; label?: string; createdAt: number };

	let users = $state<DiscordUser[]>([]);
	let discordId = $state('');
	let label = $state('');
	let error = $state('');

	async function refresh() {
		const res = await api<{ users: DiscordUser[] }>('/api/discord/users');
		if (res.data) users = res.data.users;
	}

	onMount(() => {
		void refresh();
	});

	async function add() {
		error = '';
		const res = await api<{ users: DiscordUser[] }>('/api/discord/users', {
			method: 'POST',
			body: JSON.stringify({ discordId: discordId.trim(), label: label.trim() || undefined })
		});
		if (res.error) {
			error = res.error;
			return;
		}
		if (res.data) users = res.data.users;
		discordId = '';
		label = '';
	}

	async function remove(id: string) {
		const res = await api<{ users: DiscordUser[] }>(`/api/discord/users/${encodeURIComponent(id)}`, {
			method: 'DELETE'
		});
		if (res.data) users = res.data.users;
	}
</script>

<section>
	<h1>Authorized Discord users</h1>
	<p class="lead">
		Only these Discord user IDs may run sensitive tools (shell, filesystem, memory writes). Anyone can
		still chat with public tools via DM, @mention, or /ask.
	</p>

	<form
		class="add"
		onsubmit={(e) => {
			e.preventDefault();
			void add();
		}}
	>
		<input bind:value={discordId} placeholder="Discord user ID (snowflake)" required />
		<input bind:value={label} placeholder="Label (optional)" />
		<button type="submit">Add</button>
	</form>
	{#if error}<p class="err">{error}</p>{/if}

	<ul>
		{#each users as u (u.discordId)}
			<li>
				<code>{u.discordId}</code>
				{#if u.label}<span>{u.label}</span>{/if}
				<button type="button" class="ghost" onclick={() => remove(u.discordId)}>Remove</button>
			</li>
		{:else}
			<li class="empty">No authorized users yet.</li>
		{/each}
	</ul>
</section>

<style>
	h1 {
		font-family: var(--font-display);
	}
	.lead {
		color: var(--muted);
	}
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1.25rem 0;
	}
	input {
		flex: 1;
		min-width: 160px;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.55rem 0.75rem;
		color: var(--text);
	}
	button[type='submit'] {
		background: var(--accent);
		border: none;
		color: #04150c;
		font-weight: 600;
		padding: 0.55rem 1rem;
		border-radius: 8px;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.9rem;
	}
	.ghost {
		margin-left: auto;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
		padding: 0.3rem 0.65rem;
		border-radius: 6px;
	}
	.empty {
		color: var(--muted);
		border-style: dashed;
	}
	.err {
		color: var(--danger);
	}
</style>

<script lang="ts">
	import { api } from '$lib/api';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	type User = { id: number; username: string; role: 'admin' | 'user' };

	let me = $state<User | null>(null);
	let users = $state<User[]>([]);
	let loading = $state(true);
	let error = $state('');
	let message = $state('');

	let newUsername = $state('');
	let newPassword = $state('');
	let newRole = $state<'admin' | 'user'>('user');
	let createBusy = $state(false);

	let resetPasswordId = $state<number | null>(null);
	let resetPassword = $state('');
	let resetBusy = $state(false);

	async function refresh() {
		const meRes = await api<{ user: User | null }>('/api/me');
		me = meRes.data?.user ?? null;
		if (!me || me.role !== 'admin') {
			loading = false;
			await goto('/');
			return;
		}
		const res = await api<{ users: User[] }>('/api/users');
		if (res.error) {
			error = res.error;
			loading = false;
			return;
		}
		users = res.data?.users ?? [];
		loading = false;
	}

	onMount(() => {
		void refresh();
	});

	async function createUser() {
		error = '';
		message = '';
		if (newPassword.length < 8) {
			error = 'Password must be at least 8 characters';
			return;
		}
		createBusy = true;
		const res = await api<{ users: User[] }>('/api/users', {
			method: 'POST',
			body: JSON.stringify({
				username: newUsername.trim(),
				password: newPassword,
				role: newRole
			})
		});
		createBusy = false;
		if (res.error) {
			error = res.error;
			return;
		}
		users = res.data?.users ?? [];
		newUsername = '';
		newPassword = '';
		newRole = 'user';
		message = 'User created.';
	}

	async function setRole(id: number, role: 'admin' | 'user'): Promise<boolean> {
		error = '';
		message = '';
		const res = await api<{ users: User[] }>(`/api/users/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ role })
		});
		if (res.error) {
			error = res.error;
			return false;
		}
		users = res.data?.users ?? [];
		message = 'Role updated.';
		return true;
	}

	async function applyResetPassword() {
		if (resetPasswordId == null) return;
		error = '';
		message = '';
		if (resetPassword.length < 8) {
			error = 'Password must be at least 8 characters';
			return;
		}
		resetBusy = true;
		const res = await api<{ users: User[] }>(`/api/users/${resetPasswordId}`, {
			method: 'PATCH',
			body: JSON.stringify({ password: resetPassword })
		});
		resetBusy = false;
		if (res.error) {
			error = res.error;
			return;
		}
		users = res.data?.users ?? [];
		resetPasswordId = null;
		resetPassword = '';
		message = 'Password reset.';
	}
</script>

<section>
	<h1>Users</h1>
	<p class="lead">Create accounts and manage admin / user roles for this WebUI.</p>

	{#if loading}
		<p>Loading…</p>
	{:else}
		{#if message}<p class="ok">{message}</p>{/if}
		{#if error}<p class="err">{error}</p>{/if}

		<form
			class="create"
			onsubmit={(e) => {
				e.preventDefault();
				void createUser();
			}}
		>
			<h2>Create user</h2>
			<label>
				Username
				<input bind:value={newUsername} autocomplete="off" required />
			</label>
			<label>
				Password (min 8)
				<input
					type="password"
					bind:value={newPassword}
					autocomplete="new-password"
					required
					minlength="8"
				/>
			</label>
			<label>
				Role
				<select bind:value={newRole}>
					<option value="user">user</option>
					<option value="admin">admin</option>
				</select>
			</label>
			<button type="submit" disabled={createBusy}>
				{createBusy ? 'Creating…' : 'Create user'}
			</button>
		</form>

		<ul>
			{#each users as u (u.id)}
				<li>
					<div class="meta">
						<strong>{u.username}</strong>
						<span class="role">{u.role}</span>
						{#if me?.id === u.id}<span class="you">you</span>{/if}
					</div>
					<div class="actions">
						<select
							aria-label="Role for {u.username}"
							value={u.role}
							onchange={(e) => {
								const el = e.currentTarget;
								const role = el.value as 'admin' | 'user';
								const prev = u.role;
								if (role === prev) return;
								void setRole(u.id, role).then((ok) => {
									if (!ok) el.value = prev;
								});
							}}
						>
							<option value="user">user</option>
							<option value="admin">admin</option>
						</select>
						<button
							type="button"
							class="ghost"
							onclick={() => {
								resetPasswordId = u.id;
								resetPassword = '';
								error = '';
								message = '';
							}}
						>
							Reset password
						</button>
					</div>
					{#if resetPasswordId === u.id}
						<form
							class="reset"
							onsubmit={(e) => {
								e.preventDefault();
								void applyResetPassword();
							}}
						>
							<input
								type="password"
								bind:value={resetPassword}
								placeholder="New password (min 8)"
								autocomplete="new-password"
								required
								minlength="8"
							/>
							<button type="submit" disabled={resetBusy}>
								{resetBusy ? 'Saving…' : 'Save'}
							</button>
							<button
								type="button"
								class="ghost"
								onclick={() => {
									resetPasswordId = null;
									resetPassword = '';
								}}
							>
								Cancel
							</button>
						</form>
					{/if}
				</li>
			{:else}
				<li class="empty">No users yet.</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	h1 {
		font-family: var(--font-display);
		margin-bottom: 0.25rem;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
		color: var(--text);
		grid-column: 1 / -1;
	}
	.lead {
		color: var(--muted);
		margin-top: 0;
	}
	.create {
		display: grid;
		gap: 0.75rem;
		margin: 1.5rem 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
	}
	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.9rem;
		color: var(--muted);
	}
	input,
	select {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.55rem 0.75rem;
		color: var(--text);
	}
	button[type='submit'] {
		justify-self: start;
		background: var(--accent);
		border: none;
		color: #04150c;
		font-weight: 600;
		padding: 0.55rem 1.1rem;
		border-radius: 8px;
	}
	button:disabled {
		opacity: 0.6;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}
	li {
		display: grid;
		gap: 0.65rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		flex-wrap: wrap;
	}
	.role,
	.you {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--muted);
		padding: 0.15rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.you {
		color: var(--accent);
		border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.actions select {
		min-width: 7rem;
	}
	.ghost {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
		padding: 0.4rem 0.7rem;
		border-radius: 6px;
	}
	.reset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.reset input {
		flex: 1;
		min-width: 160px;
	}
	.empty {
		color: var(--muted);
		border-style: dashed;
	}
	.ok {
		color: var(--accent);
	}
	.err {
		color: var(--danger);
	}
</style>

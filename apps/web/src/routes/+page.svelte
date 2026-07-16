<script lang="ts">
	import { api } from '$lib/api';
	import { onMount } from 'svelte';

	type Msg = { role: string; content: string };

	let messages = $state<Msg[]>([]);
	let input = $state('');
	let busy = $state(false);
	let error = $state('');

	onMount(async () => {
		const res = await api<{ messages: Msg[] }>('/api/chat/history');
		if (res.data) messages = res.data.messages;
	});

	async function send() {
		const text = input.trim();
		if (!text || busy) return;
		busy = true;
		error = '';
		input = '';
		messages = [...messages, { role: 'user', content: text }];
		const res = await api<{ reply: string }>('/api/chat', {
			method: 'POST',
			body: JSON.stringify({ message: text })
		});
		if (res.error) {
			error = res.error;
			messages = [...messages, { role: 'assistant', content: `Error: ${res.error}` }];
		} else if (res.data) {
			messages = [...messages, { role: 'assistant', content: res.data.reply }];
		}
		busy = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}
</script>

<section class="chat">
	<header class="hero">
		<h1>CottAssistant</h1>
		<p>Local full-agent assistant — chat, Discord, and voice.</p>
	</header>

	<div class="log">
		{#each messages as m, i (i + m.role + m.content.slice(0, 24))}
			<div class="bubble" class:user={m.role === 'user'} class:assistant={m.role === 'assistant'}>
				<span class="role">{m.role}</span>
				<pre>{m.content}</pre>
			</div>
		{:else}
			<p class="empty">No messages yet. Ask anything.</p>
		{/each}
	</div>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	<form
		class="composer"
		onsubmit={(e) => {
			e.preventDefault();
			void send();
		}}
	>
		<textarea
			bind:value={input}
			rows="3"
			placeholder="Message CottAssistant…"
			onkeydown={onKey}
			disabled={busy}
		></textarea>
		<button type="submit" disabled={busy || !input.trim()}>{busy ? 'Thinking…' : 'Send'}</button>
	</form>
</section>

<style>
	.hero h1 {
		font-family: var(--font-display);
		font-size: 2.4rem;
		margin: 0 0 0.35rem;
		letter-spacing: -0.03em;
	}
	.hero p {
		margin: 0 0 1.25rem;
		color: var(--muted);
	}
	.log {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		min-height: 40vh;
		margin-bottom: 1rem;
	}
	.bubble {
		padding: 0.85rem 1rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
	}
	.bubble.user {
		border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
	}
	.role {
		display: block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		margin-bottom: 0.35rem;
		font-family: var(--font-mono);
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
		font-family: var(--font-body);
		line-height: 1.45;
	}
	.empty {
		color: var(--muted);
	}
	.err {
		color: var(--danger);
	}
	.composer {
		display: grid;
		gap: 0.65rem;
	}
	textarea {
		width: 100%;
		resize: vertical;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.85rem 1rem;
	}
	button[type='submit'] {
		justify-self: end;
		background: var(--accent);
		color: #04150c;
		border: none;
		font-weight: 600;
		padding: 0.55rem 1.2rem;
		border-radius: 8px;
	}
	button[type='submit']:disabled {
		opacity: 0.5;
	}
</style>

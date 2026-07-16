<script lang="ts">
	import { api } from '$lib/api';
	import { onMount } from 'svelte';

	type CronJob = {
		id: number;
		title: string;
		prompt: string;
		complexity: 'simple' | 'complex';
		deliverDiscord: boolean;
		deliverVoice: boolean;
		discordUserId: string | null;
		voicePointId: string | null;
		nextRunAt: number;
		intervalMs: number | null;
		createdByKind: string;
		createdById: string;
		status: string;
		lastRunAt: number | null;
		lastTokens: number | null;
		createdAt: number;
	};

	let jobs = $state<CronJob[]>([]);
	let error = $state('');
	let title = $state('');
	let prompt = $state('');
	let runInSeconds = $state('600');
	let everySeconds = $state('');
	let deliver = $state<'discord_dm' | 'voice' | 'both'>('voice');
	let complexity = $state<'simple' | 'complex'>('simple');
	let discordUserId = $state('');
	let voicePointId = $state('local');

	async function refresh() {
		const res = await api<{ jobs: CronJob[] }>('/api/crons');
		if (res.data) jobs = res.data.jobs;
	}

	onMount(() => {
		void refresh();
	});

	function formatWhen(ms: number): string {
		return new Date(ms).toLocaleString();
	}

	function deliverLabel(j: CronJob): string {
		const parts: string[] = [];
		if (j.deliverDiscord) parts.push(`DM ${j.discordUserId ?? '?'}`);
		if (j.deliverVoice) parts.push(`voice:${j.voicePointId ?? 'local'}`);
		return parts.join(' + ') || 'none';
	}

	async function create() {
		error = '';
		const body: Record<string, unknown> = {
			title: title.trim(),
			prompt: prompt.trim(),
			deliver,
			complexity,
			voicePointId: voicePointId.trim() || 'local',
			discordUserId: discordUserId.trim() || undefined
		};
		const rin = Number(runInSeconds);
		const every = everySeconds.trim() ? Number(everySeconds) : undefined;
		if (Number.isFinite(rin) && rin > 0) body.runInSeconds = rin;
		if (every != null && Number.isFinite(every)) body.everySeconds = every;

		const res = await api<{ job: CronJob }>('/api/crons', {
			method: 'POST',
			body: JSON.stringify(body)
		});
		if (res.error) {
			error = res.error;
			return;
		}
		title = '';
		prompt = '';
		await refresh();
	}

	async function cancel(id: number) {
		const res = await api<{ jobs: CronJob[] }>(`/api/crons/${id}`, { method: 'DELETE' });
		if (res.data) jobs = res.data.jobs;
		else await refresh();
	}
</script>

<section>
	<h1>Scheduled crons</h1>
	<p class="lead">
		Reminders, alarms, and recurring checks. When a job fires, the LLM runs the prompt and can DM
		you on Discord, speak IRL, or both. Unauthorized Discord users are limited to 3 simple jobs
		(≤500 tokens per run). WebUI and voice have no such limit.
	</p>

	<form
		class="create"
		onsubmit={(e) => {
			e.preventDefault();
			void create();
		}}
	>
		<input bind:value={title} placeholder="Title" required />
		<textarea bind:value={prompt} placeholder="What should happen when it fires?" required rows="3"
		></textarea>
		<div class="row">
			<label>
				Run in (seconds)
				<input bind:value={runInSeconds} type="number" min="5" />
			</label>
			<label>
				Every (seconds, optional)
				<input bind:value={everySeconds} type="number" min="60" placeholder="one-shot" />
			</label>
			<label>
				Deliver
				<select bind:value={deliver}>
					<option value="voice">Voice (IRL)</option>
					<option value="discord_dm">Discord DM</option>
					<option value="both">Both</option>
				</select>
			</label>
			<label>
				Complexity
				<select bind:value={complexity}>
					<option value="simple">Simple</option>
					<option value="complex">Complex</option>
				</select>
			</label>
		</div>
		<div class="row">
			<label>
				Discord user ID
				<input bind:value={discordUserId} placeholder="required for DM" />
			</label>
			<label>
				Voice point
				<input bind:value={voicePointId} placeholder="local" />
			</label>
		</div>
		<button type="submit">Create cron</button>
	</form>
	{#if error}<p class="err">{error}</p>{/if}

	<ul>
		{#each jobs as j (j.id)}
			<li>
				<div class="meta">
					<strong>#{j.id} {j.title}</strong>
					<span class="status">{j.status}</span>
					<span class="dim">{j.complexity} · {deliverLabel(j)}</span>
					<span class="dim">next {formatWhen(j.nextRunAt)}</span>
					{#if j.intervalMs}
						<span class="dim">every {Math.round(j.intervalMs / 1000)}s</span>
					{/if}
					{#if j.lastTokens != null}
						<span class="dim">last {j.lastTokens} tok</span>
					{/if}
					<p class="prompt">{j.prompt}</p>
				</div>
				{#if j.status === 'active' || j.status === 'paused'}
					<button type="button" class="ghost" onclick={() => cancel(j.id)}>Cancel</button>
				{/if}
			</li>
		{:else}
			<li class="empty">No crons yet — ask the assistant or create one above.</li>
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
	.create {
		display: grid;
		gap: 0.65rem;
		margin: 1.25rem 0 1.5rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--muted);
		flex: 1;
		min-width: 140px;
	}
	input,
	textarea,
	select {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.55rem 0.75rem;
		color: var(--text);
		font: inherit;
	}
	button[type='submit'] {
		justify-self: start;
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
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		flex: 1;
		min-width: 0;
	}
	.status {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.dim {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.prompt {
		margin: 0.35rem 0 0;
		color: var(--text);
		font-size: 0.92rem;
		white-space: pre-wrap;
	}
	.ghost {
		margin-left: auto;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
		padding: 0.3rem 0.65rem;
		border-radius: 6px;
		flex-shrink: 0;
	}
	.empty {
		color: var(--muted);
		border-style: dashed;
	}
	.err {
		color: var(--danger);
	}
</style>

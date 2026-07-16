<script lang="ts">
	import { api } from '$lib/api';
	import { onMount } from 'svelte';

	type Device = { id: string; name: string; direction: 'input' | 'output' };
	type Point = {
		id: string;
		name: string;
		inputDeviceId: string | null;
		outputDeviceId: string | null;
		connected: boolean;
		lastSeenAt: number | null;
		devices?: Device[];
	};

	let devices = $state<Device[]>([]);
	let local = $state<Point | null>(null);
	let points = $state<Point[]>([]);
	let daemonToken = $state('');
	let voiceEnabled = $state(false);
	let message = $state('');
	let error = $state('');

	const inputs = $derived(devices.filter((d) => d.direction === 'input'));
	const outputs = $derived(devices.filter((d) => d.direction === 'output'));

	async function refresh() {
		const [devRes, ptsRes, settingsRes] = await Promise.all([
			api<{ devices: Device[] }>('/api/audio/devices'),
			api<{ local: Point; points: Point[]; daemonToken: string }>('/api/voice/points'),
			api<{ settings: { voiceEnabled: boolean } }>('/api/settings')
		]);
		if (devRes.data) devices = devRes.data.devices;
		if (ptsRes.data) {
			local = {
				...ptsRes.data.local,
				inputDeviceId: ptsRes.data.local.inputDeviceId ?? '',
				outputDeviceId: ptsRes.data.local.outputDeviceId ?? ''
			};
			points = ptsRes.data.points.map((p) => ({
				...p,
				inputDeviceId: p.inputDeviceId ?? '',
				outputDeviceId: p.outputDeviceId ?? ''
			}));
			daemonToken = ptsRes.data.daemonToken;
		}
		if (settingsRes.data) voiceEnabled = settingsRes.data.settings.voiceEnabled;
	}

	onMount(() => {
		void refresh();
	});

	async function saveLocal() {
		if (!local) return;
		message = '';
		error = '';
		const res = await api('/api/voice/points/local', {
			method: 'PUT',
			body: JSON.stringify({
				inputDeviceId: local.inputDeviceId || null,
				outputDeviceId: local.outputDeviceId || null,
				voiceEnabled
			})
		});
		if (res.error) {
			error = res.error;
			return;
		}
		message = 'Local audio saved.';
		await refresh();
	}

	async function savePoint(p: Point) {
		error = '';
		const res = await api(`/api/voice/points/${encodeURIComponent(p.id)}`, {
			method: 'PUT',
			body: JSON.stringify({
				inputDeviceId: p.inputDeviceId || null,
				outputDeviceId: p.outputDeviceId || null
			})
		});
		if (res.error) {
			error = res.error;
			return;
		}
		message = `Saved devices for ${p.name}.`;
	}
</script>

<section>
	<h1>Voice & audio</h1>
	<p class="lead">
		Devices are enumerated on the machine running CottAssistant (or each satellite daemon) — not in
		your browser.
	</p>

	{#if local}
		<div class="card">
			<h2>Local hub</h2>
			<p class="status" class:on={local.connected || voiceEnabled}>
				{voiceEnabled ? (local.connected ? 'Running' : 'Enabled') : 'Disabled'}
			</p>
			<label class="check">
				<input type="checkbox" bind:checked={voiceEnabled} />
				Enable local wake / listen loop
			</label>
			<label>
				Input (microphone)
				<select bind:value={local.inputDeviceId}>
					<option value="">— default —</option>
					{#each inputs as d}
						<option value={d.id}>{d.name}</option>
					{/each}
				</select>
			</label>
			<label>
				Output (speakers)
				<select bind:value={local.outputDeviceId}>
					<option value="">— default —</option>
					{#each outputs as d}
						<option value={d.id}>{d.name}</option>
					{/each}
				</select>
			</label>
			<button type="button" onclick={() => saveLocal()}>Save local devices</button>
		</div>
	{/if}

	<div class="card">
		<h2>Satellite daemons</h2>
		<p class="hint">
			On another machine:
			<code
				>VOICE_DAEMON_TOKEN=… VOICE_POINT_NAME="Kitchen" bun run voice-daemon</code
			>
		</p>
		<p class="hint">Token: <code>{daemonToken || '…'}</code></p>

		{#each points as p (p.id)}
			{@const pInputs = (p.devices ?? devices).filter((d) => d.direction === 'input')}
			{@const pOutputs = (p.devices ?? devices).filter((d) => d.direction === 'output')}
			<div class="point">
				<div class="row">
					<strong>{p.name}</strong>
					<span class="badge" class:on={p.connected}>{p.connected ? 'connected' : 'offline'}</span>
				</div>
				<label>
					Input
					<select bind:value={p.inputDeviceId}>
						<option value="">—</option>
						{#each pInputs as d}
							<option value={d.id}>{d.name}</option>
						{/each}
					</select>
				</label>
				<label>
					Output
					<select bind:value={p.outputDeviceId}>
						<option value="">—</option>
						{#each pOutputs as d}
							<option value={d.id}>{d.name}</option>
						{/each}
					</select>
				</label>
				<button type="button" onclick={() => savePoint(p)}>Save point</button>
			</div>
		{:else}
			<p class="hint">No satellite points connected yet.</p>
		{/each}
	</div>

	{#if message}<p class="ok">{message}</p>{/if}
	{#if error}<p class="err">{error}</p>{/if}
</section>

<style>
	h1 {
		font-family: var(--font-display);
	}
	.lead,
	.hint {
		color: var(--muted);
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		word-break: break-all;
	}
	.card {
		margin-top: 1.25rem;
		padding: 1.1rem 1.2rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg-elevated);
		display: grid;
		gap: 0.75rem;
	}
	h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	.status {
		margin: 0;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}
	.status.on {
		color: var(--accent);
	}
	label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.9rem;
		color: var(--muted);
	}
	label.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text);
	}
	select {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
		color: var(--text);
	}
	button {
		justify-self: start;
		background: var(--accent);
		border: none;
		color: #04150c;
		font-weight: 600;
		padding: 0.5rem 1rem;
		border-radius: 8px;
	}
	.point {
		display: grid;
		gap: 0.55rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.badge {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--muted);
	}
	.badge.on {
		color: var(--accent);
	}
	.ok {
		color: var(--accent);
	}
	.err {
		color: var(--danger);
	}
</style>

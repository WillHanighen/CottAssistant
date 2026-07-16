<script lang="ts">
	import { api } from '$lib/api';
	import { onMount } from 'svelte';

	type ModelOption = { id: string; label: string; description?: string; ready?: boolean };
	type ModelStatus = {
		wakeWord: { id: string; ready: boolean };
		whisper: { id: string; ready: boolean };
		piper: { id: string; ready: boolean };
		owwShared: { ready: boolean };
	};
	type Settings = {
		openrouterApiKey: string;
		openrouterModel: string;
		discordToken: string;
		voiceDaemonToken: string;
		whisperBinary: string;
		whisperModel: string;
		piperBinary: string;
		piperModel: string;
		wakeWordModel: string;
		voiceEnabled: boolean;
		hasOpenrouterKey: boolean;
		hasDiscordToken: boolean;
	};

	let settings = $state<Settings | null>(null);
	let catalog = $state<{
		wakeWord: ModelOption[];
		whisper: ModelOption[];
		piper: ModelOption[];
	} | null>(null);
	let modelStatus = $state<ModelStatus | null>(null);
	let openrouterApiKey = $state('');
	let discordToken = $state('');
	let message = $state('');
	let error = $state('');
	let installing = $state(false);

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordMessage = $state('');
	let passwordError = $state('');
	let passwordBusy = $state(false);

	function optionLabel(opt: ModelOption): string {
		const mark = opt.ready === true ? ' · installed' : opt.ready === false ? ' · download' : '';
		return `${opt.label}${mark}`;
	}

	/** Keep current selection visible even if it is a legacy / custom id. */
	function optionsWithCurrent(list: ModelOption[] | undefined, current: string): ModelOption[] {
		const opts = list ?? [];
		if (!current || opts.some((o) => o.id === current)) return opts;
		return [{ id: current, label: `${current} (current)`, ready: false }, ...opts];
	}

	onMount(async () => {
		const res = await api<{
			settings: Settings;
			catalog: typeof catalog;
			modelStatus: ModelStatus;
		}>('/api/settings');
		if (res.error) {
			error = res.error;
			return;
		}
		if (res.data) {
			settings = res.data.settings;
			catalog = res.data.catalog;
			modelStatus = res.data.modelStatus;
			openrouterApiKey = '';
			discordToken = '';
		}
	});

	async function save() {
		if (!settings) return;
		message = '';
		error = '';
		installing = true;
		const body: Record<string, unknown> = {
			openrouterModel: settings.openrouterModel,
			whisperBinary: settings.whisperBinary,
			whisperModel: settings.whisperModel,
			piperBinary: settings.piperBinary,
			piperModel: settings.piperModel,
			wakeWordModel: settings.wakeWordModel,
			voiceEnabled: settings.voiceEnabled,
			voiceDaemonToken: settings.voiceDaemonToken
		};
		if (openrouterApiKey.trim()) body.openrouterApiKey = openrouterApiKey.trim();
		if (discordToken.trim()) body.discordToken = discordToken.trim();

		const res = await api<{
			settings: Settings;
			catalog: typeof catalog;
			modelStatus: ModelStatus;
			installError?: string;
		}>('/api/settings', {
			method: 'PUT',
			body: JSON.stringify(body)
		});
		installing = false;
		if (res.error) {
			error = res.error;
			return;
		}
		if (res.data) {
			settings = res.data.settings;
			if (res.data.catalog) catalog = res.data.catalog;
			if (res.data.modelStatus) modelStatus = res.data.modelStatus;
			openrouterApiKey = '';
			discordToken = '';
			if (res.data.installError) {
				error = `Saved, but model install failed: ${res.data.installError}`;
				message = '';
			} else {
				message = 'Saved. Voice models installed if needed.';
			}
		}
	}

	async function installNow() {
		if (!settings) return;
		installing = true;
		error = '';
		message = '';
		const res = await api<{ modelStatus: ModelStatus; catalog?: typeof catalog }>(
			'/api/models/ensure',
			{
				method: 'POST',
				body: JSON.stringify({
					wakeWord: settings.wakeWordModel,
					whisper: settings.whisperModel,
					piper: settings.piperModel
				})
			}
		);
		installing = false;
		if (res.error) {
			error = res.error;
			return;
		}
		if (res.data?.modelStatus) modelStatus = res.data.modelStatus;
		if (res.data?.catalog) catalog = res.data.catalog;
		message = 'Models installed.';
	}

	function readyLabel(ready: boolean | undefined): string {
		if (ready === undefined) return '';
		return ready ? 'ready' : 'not installed';
	}

	async function changePassword() {
		passwordMessage = '';
		passwordError = '';
		if (newPassword.length < 8) {
			passwordError = 'New password must be at least 8 characters';
			return;
		}
		if (newPassword !== confirmPassword) {
			passwordError = 'New passwords do not match';
			return;
		}
		passwordBusy = true;
		const res = await api('/api/me/password', {
			method: 'POST',
			body: JSON.stringify({ currentPassword, newPassword })
		});
		passwordBusy = false;
		if (res.error) {
			passwordError = res.error;
			return;
		}
		currentPassword = '';
		newPassword = '';
		confirmPassword = '';
		passwordMessage = 'Password updated.';
	}
</script>

<section>
	<h1>Settings</h1>
	<p class="lead">API keys and local voice models. Bound to this host only.</p>

	{#if settings}
		<form
			class="grid"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label>
				OpenRouter API key {settings.hasOpenrouterKey ? '(set)' : '(missing)'}
				<input
					type="password"
					bind:value={openrouterApiKey}
					placeholder={settings.openrouterApiKey || 'sk-or-…'}
					autocomplete="off"
				/>
			</label>
			<label>
				OpenRouter model
				<input bind:value={settings.openrouterModel} />
			</label>
			<label>
				Discord bot token {settings.hasDiscordToken ? '(set)' : '(missing)'}
				<input
					type="password"
					bind:value={discordToken}
					placeholder={settings.discordToken || 'Bot token'}
					autocomplete="off"
				/>
			</label>
			<label>
				Voice daemon token
				<input bind:value={settings.voiceDaemonToken} />
			</label>

			<h2>Voice models</h2>
			<p class="hint">
				Dropdowns list common models you can download — not only what is already on disk. Selecting
				one downloads it into <code>data/models/</code> on save (or when voice is enabled). Defaults
				target ~8GB+ VRAM hosts (Whisper medium.en, Piper Lessac high).
			</p>

			<label>
				Wake word
				<span class="status" class:ready={modelStatus?.wakeWord.ready}>
					{readyLabel(modelStatus?.wakeWord.ready)}
				</span>
				<select bind:value={settings.wakeWordModel}>
					{#each optionsWithCurrent(catalog?.wakeWord, settings.wakeWordModel) as opt (opt.id)}
						<option value={opt.id} title={opt.description ?? ''}>{optionLabel(opt)}</option>
					{/each}
				</select>
			</label>
			<label>
				Whisper (speech-to-text)
				<span class="status" class:ready={modelStatus?.whisper.ready}>
					{readyLabel(modelStatus?.whisper.ready)}
				</span>
				<select bind:value={settings.whisperModel}>
					{#each optionsWithCurrent(catalog?.whisper, settings.whisperModel) as opt (opt.id)}
						<option value={opt.id} title={opt.description ?? ''}>{optionLabel(opt)}</option>
					{/each}
				</select>
			</label>
			<label>
				Piper (text-to-speech)
				<span class="status" class:ready={modelStatus?.piper.ready}>
					{readyLabel(modelStatus?.piper.ready)}
				</span>
				<select bind:value={settings.piperModel}>
					{#each optionsWithCurrent(catalog?.piper, settings.piperModel) as opt (opt.id)}
						<option value={opt.id} title={opt.description ?? ''}>{optionLabel(opt)}</option>
					{/each}
				</select>
			</label>

			<label class="check">
				<input type="checkbox" bind:checked={settings.voiceEnabled} />
				Enable local voice hub
			</label>

			{#if message}<p class="ok">{message}</p>{/if}
			{#if error}<p class="err">{error}</p>{/if}
			<div class="actions">
				<button type="submit" disabled={installing}>
					{installing ? 'Saving / installing…' : 'Save settings'}
				</button>
				<button type="button" class="secondary" disabled={installing} onclick={() => installNow()}>
					Install models now
				</button>
			</div>
		</form>
	{:else if error}
		<p class="err">Failed to load settings: {error}</p>
	{:else}
		<p>Loading…</p>
	{/if}

	<div class="account">
		<h2>Account</h2>
		<p class="hint">Change your WebUI password. Other sessions will be signed out.</p>
		<form
			class="grid"
			onsubmit={(e) => {
				e.preventDefault();
				void changePassword();
			}}
		>
			<label>
				Current password
				<input
					type="password"
					bind:value={currentPassword}
					autocomplete="current-password"
					required
				/>
			</label>
			<label>
				New password (min 8)
				<input
					type="password"
					bind:value={newPassword}
					autocomplete="new-password"
					required
					minlength="8"
				/>
			</label>
			<label>
				Confirm new password
				<input
					type="password"
					bind:value={confirmPassword}
					autocomplete="new-password"
					required
					minlength="8"
				/>
			</label>
			{#if passwordMessage}<p class="ok">{passwordMessage}</p>{/if}
			{#if passwordError}<p class="err">{passwordError}</p>{/if}
			<button type="submit" disabled={passwordBusy}>
				{passwordBusy ? 'Updating…' : 'Change password'}
			</button>
		</form>
	</div>
</section>

<style>
	h1 {
		font-family: var(--font-display);
		margin-bottom: 0.25rem;
	}
	h2 {
		margin: 0.75rem 0 0;
		font-size: 1.05rem;
		color: var(--text);
	}
	.lead {
		color: var(--muted);
		margin-top: 0;
	}
	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.hint code {
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}
	.grid {
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
	label.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text);
	}
	.status {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--muted);
	}
	.status.ready {
		color: var(--accent);
	}
	input[type='password'],
	input,
	select {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.55rem 0.75rem;
		color: var(--text);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	button {
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
	button.secondary {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
	}
	.ok {
		color: var(--accent);
	}
	.err {
		color: var(--danger);
	}
	.account {
		margin-top: 2.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border);
	}
	.account h2 {
		font-family: var(--font-display);
		font-size: 1.25rem;
		margin: 0 0 0.35rem;
	}
</style>

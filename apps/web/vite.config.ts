import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: '127.0.0.1',
		port: 5173,
		proxy: {
			'/api': 'http://127.0.0.1:8787',
			'/ws': {
				target: 'ws://127.0.0.1:8787',
				ws: true
			}
		},
		watch: {
			// Avoid reloading when `bun run build` writes into apps/web/build
			ignored: ['**/build/**', '**/.svelte-kit/output/**']
		}
	}
});

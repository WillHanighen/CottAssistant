export async function api<T>(
	path: string,
	init?: RequestInit
): Promise<{ data?: T; error?: string; status: number }> {
	try {
		const res = await fetch(path, {
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				...(init?.headers ?? {})
			},
			...init
		});
		let body: unknown = null;
		try {
			body = await res.json();
		} catch {
			body = null;
		}
		if (!res.ok) {
			const err =
				body && typeof body === 'object' && body !== null && 'error' in body
					? String((body as { error: unknown }).error)
					: res.statusText || `HTTP ${res.status}`;
			return { error: err, status: res.status };
		}
		return { data: (body ?? undefined) as T | undefined, status: res.status };
	} catch (err) {
		return {
			error: err instanceof Error ? err.message : String(err),
			status: 0
		};
	}
}

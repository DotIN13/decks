/**
 * The stage's font files, fetched once each (`cards/font-files.ts` names them) and kept: an engine
 * started again after its device was lost is given them from here, and `pending` says how many are
 * still on their way, which is what tells a frame it is not yet sharp.
 */
import { isFallbackFamily, type FontFile } from "../cards/font-files.ts";

/** A font as both engines take it: the file (`blob`), and its `bytes` until the worker has been handed them. */
export type Font = { family: string; fallback: boolean; blob: Blob; bytes?: Uint8Array };

export class FontLoader {
	/** The fonts loaded so far, in the order they landed. */
	readonly fonts: Font[] = [];
	/** Font files asked for and not yet given to the engines. */
	pending = 0;
	/** Font files asked for, by key, so each is fetched once. */
	private readonly asked = new Set<string>();
	/** Font files settled, by key: given to the engines, or not to be had. */
	private readonly settled = new Set<string>();

	constructor(private readonly host: { due(): void; loaded(fonts: Font[]): void }) {}

	/** Whether the file is settled: the engines have it, or it could not be had. */
	has(key: string): boolean {
		return this.settled.has(key);
	}

	/** Fetch the files among `wanted` not asked for yet, each from its address then its fallback, and hand what landed to the host. */
	fetch(wanted: readonly FontFile[]): void {
		const files = wanted.filter((file) => !this.asked.has(file.key));
		if (!files.length) return;
		for (const file of files) this.asked.add(file.key);
		this.pending += files.length;
		this.host.due();
		void Promise.all(
			files.map(async (file) => {
				for (const url of [file.url, file.fallback].filter(Boolean) as string[]) {
					try {
						const response = await fetch(url);
						if (!response.ok) continue;
						const blob = await response.blob();
						return { file, blob, bytes: new Uint8Array(await blob.arrayBuffer()) };
					} catch {
						/* the next address */
					}
				}
				return undefined;
			}),
		).then((loaded) => {
			this.pending -= files.length;
			for (const file of files) this.settled.add(file.key);
			// Kept first: an engine started (or started again) is given them from here.
			const fonts: Font[] = loaded.filter((one) => one !== undefined).map((one) => ({ family: one.file.family, blob: one.blob, bytes: one.bytes, fallback: isFallbackFamily(one.file.family) }));
			this.fonts.push(...fonts);
			this.host.loaded(fonts);
		});
	}
}

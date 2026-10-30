/**
 * How a card's file is read (`card-surface.tsx`): its HTML mounted once it has come, and nothing done
 * when it has not. A file that did not come (a ticket run out, the server restarting, a network hiccup)
 * leaves the card as it was, its picture still shown, and is asked for once more a moment later: a card
 * mounted empty was blank paper where its picture had been.
 */
export interface CardLoad {
	/** Read the file now, as asked anew: its address may have changed. */
	load(): void;
	/** Stop: what is still on its way is dropped, and no retry is made. */
	stop(): void;
}

export function cardLoader(options: {
	/** The file's address now. */
	url(): string;
	read(url: string): Promise<Pick<Response, "ok" | "text">>;
	/** The file's HTML, to mount. */
	mount(html: string): void;
	/** How long to wait before the one retry. */
	retryMs?: number;
	setTimer?: (run: () => void, ms: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}): CardLoad {
	const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
	const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	let asked = 0;
	let timer: unknown;
	let retried = false;
	const clear = () => {
		if (timer !== undefined) clearTimer(timer);
		timer = undefined;
	};
	const load = async (retry: boolean) => {
		if (!retry) retried = false;
		clear();
		const ask = ++asked;
		let html: string | undefined;
		try {
			const response = await options.read(options.url());
			html = response.ok ? await response.text() : undefined;
		} catch {
			html = undefined;
		}
		if (ask !== asked) return;
		if (html === undefined) {
			if (!retried) {
				retried = true;
				timer = setTimer(() => void load(true), options.retryMs ?? 5000);
			}
			return;
		}
		options.mount(html);
	};
	return {
		load: () => void load(false),
		stop: () => {
			asked++;
			clear();
		},
	};
}

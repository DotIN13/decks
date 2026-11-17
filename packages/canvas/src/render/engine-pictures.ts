import { knobs } from "../base/debug.ts";
import { markMissing, saysMissing } from "../base/missing.ts";
import { pictureAddress } from "../base/host.ts";
import type { SceneCard } from "./types.ts";
import { knownGpuClass, PICTURES } from "./device.ts";
import { upgrades } from "./picture-ladder.ts";
import type { CanvasEngine } from "./engine.ts";

/** Card pictures copied to the GPU in one frame (`putPaced`). */
const PICTURES_PER_FRAME = 1;

/** A card whose picture can be fetched: it names one by address, and is not a live page still loading. */
const fetchable = (card: SceneCard) => !!card.picture && !(card.live && !card.ready) && /^(https?:|\/)/.test(card.picture);

/** What a card's picture is held under in both engines: `card:<path>` (`CardPlace` in the Rust engine). */
export const pictureKey = (path: string) => `card:${path}`;

/** How long the camera rests before the pictures are held to their budget (`fitPictures`). */
const REST_MS = 250;

/** Pictures fetched at once, and a stand-in picture asked for again this often, this many times. */
const FETCHES = 6;

/**
 * A card picture compressed for the GPU, as the server sends it (`apps/server/src/boards/astc.ts`):
 * `DKA1`, width, height and the number of sizes, each size's length, then the sizes' ASTC blocks.
 * What `putCompressedPicture` takes: the bytes, and `[at, length, …]` of each size.
 */
function readCompressed(data: Uint8Array): { data: Uint8Array; width: number; height: number; spans: Uint32Array; bytes: number } | undefined {
	if (data.length < 16 || String.fromCharCode(...data.subarray(0, 4)) !== "DKA1") return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const width = view.getUint32(4, true);
	const height = view.getUint32(8, true);
	const levels = view.getUint32(12, true);
	const spans = new Uint32Array(levels * 2);
	let at = 16 + 4 * levels;
	for (let n = 0; n < levels; n++) {
		const length = view.getUint32(16 + 4 * n, true);
		spans[n * 2] = at;
		spans[n * 2 + 1] = length;
		at += length;
	}
	if (at > data.length || levels === 0) return undefined;
	return { data, width, height, spans, bytes: at - (16 + 4 * levels) };
}

const STAND_IN_TRIES = 50;

const STAND_IN_RETRY_MS = 1200;

/** How long to wait before asking again for a picture that did not load, each time it fails again. */
const PICTURE_RETRY_MS = [2000, 5000, 15000, 30000, 60000];

/** Pictures from the worker that come within this long of the first are laid out for together. */
const PICTURES_BATCH_MS = 16;

/**
 * The cards' pictures: which to fetch for the cards near the window, at which size, and how many
 * bytes the GPU may hold for them (the budget of `picture-ladder.ts` and `device.ts`). A picture is
 * fetched once, given to both engines a frame at a time, and dropped when the budget is over. A part
 * of the engine (`engine.ts`), which it reaches through `of`.
 */
export class EnginePictures {
	constructor(private readonly of: CanvasEngine) {}

	/**
	 * Pictures fetched, by key: the address fetched (a board's may carry a size), the board's own
	 * address for it, stand-in retries, and for a board's the copy's width (0: the whole picture).
	 */
	picturesAsked = new Map<string, { url: string; source: string; tries: number; size?: number; failed?: number }>();

	private fetching = 0;

	/** Each card picture on the GPU: its bytes, its smaller sizes included (`fitPictures`). */
	pictureBytes = new Map<string, number>();

	/** Each card picture's width on the GPU, after any shrinking: the rung it holds (`wantCardPictures`). */
	heldWidth = new Map<string, number>();

	/**
	 * Card picture keys that may hold nothing and have nothing asked (`holds` of 0): what a camera step
	 * has to look at. Added to whenever a card's picture state may have fallen to nothing (the cards sent
	 * again, a new revision, a fetch let go, the engine started again), and cleared of a key once a step
	 * finds it holding something: so a step with nothing in it costs nothing, where it searched the index
	 * and sorted the hundred cards near the window at every frame of a zoom (a quarter of the script time
	 * on an iPad), for a list that is empty once every card has a picture.
	 */
	unpictured = new Set<string>();

	/** Each placed card by its picture key, for `unpictured`. */
	cardByKey = new Map<string, SceneCard>();

	/** Card pictures put compressed (`putCompressedPicture`), for checks. */
	private compressedPut = 0;

	/** Each compressed card picture's width and height, for checks. */
	compressedSize = new Map<string, [number, number]>();

	fitTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Board pictures waiting to be copied to the GPU, `PICTURES_PER_FRAME` a frame. Copying one is done
	 * on the page's thread (`copyExternalImageToTexture`), about 2 ms on an iPad mini, and a pan below
	 * the live zoom that brought a dozen boards in copied them all in one frame: the top cost of that pan.
	 */
	putQueue: Array<() => void> = [];

	putFrame = 0;

	private putSome = (): void => {
		this.putFrame = 0;
		// `knobs.picturesPerFrame` changes it, for measuring.
		const most = knobs.picturesPerFrame ?? PICTURES_PER_FRAME;
		for (let i = 0; i < most && this.putQueue.length > 0; i++) this.putQueue.shift()!();
		if (this.putQueue.length > 0 && !this.of.disposed) this.putFrame = requestAnimationFrame(this.putSome);
	};

	private picturesTimer: ReturnType<typeof setTimeout> | undefined;

	/** The pictures put on the page engine, of boards and of fills: for checks. */
	picturesPut = 0;

	/** The widest and tallest a picture is kept (the device's limit, or 4096): bigger ones are resized. */
	maxPicture = 4096;

	/**
	 * Card pictures, by this device's GPU (`device.ts`, `readGpuClass`): the ladder each card's is
	 * fetched from, at the rung its drawn width needs (`picture-ladder.ts`), and drawn at any zoom from
	 * the smaller sizes the GPU makes of it. Big until the adapter has been asked.
	 */
	pictures = PICTURES[knownGpuClass()];

	/** The pictures the cards near the window want, asked for at the next frame (`setCamera`). */
	picturesSoon = false;

	/**
	 * Fetch the pictures of the cards near the window, each at the rung of this device's ladder its
	 * drawn width needs (`picture-ladder.ts`). While the camera moves only a card with no picture is
	 * fetched, at the bottom rung: nothing is fetched to sharpen a picture mid-gesture, and the GPU's
	 * smaller sizes of what is held cover a zoom out. At rest each card wanting a higher rung than it
	 * holds is fetched again, nearest the screen's middle first, while it fits the budget; the lower
	 * picture stays drawn until the higher one replaces it.
	 */
	wantCardPictures(): void {
		if (!this.of.page || !this.of.view.width) return;
		const w = this.of.view.width / this.of.camera.zoom;
		const h = this.of.view.height / this.of.camera.zoom;
		const left = this.of.camera.x - w;
		const top = this.of.camera.y - h;
		// What a camera step wants is found from `unpictured` alone (`unpicturedNear`): the index is asked only at rest.
		if (this.of.moving && this.unpictured.size === 0) return;
		// The cards near the window, from the index `setCards` keeps (built from these cards, in their order).
		const near = this.of.moving
			? []
			: (this.of.questions.indexed !== this.of.cardLayer.placedCards ? this.of.cardLayer.placedCards : this.of.questions.cardIndex.search({ x: left, y: top, w: w * 2, h: h * 2 }).map((at) => this.of.cardLayer.placedCards[at]!)).filter((card) => fetchable(card) && !(card.x + card.w < left || card.x > left + w * 2 || card.y + card.h < top || card.y > top + h * 2));
		const ladder = this.pictures.ladder;
		const byKey = this.of.moving ? this.cardByKey : new Map(near.map((card) => [pictureKey(card.path), card]));
		// What a card holds or is fetching: the rung asked, or the width on the GPU, whichever is more.
		const holds = (key: string) => Math.max(this.picturesAsked.get(key)?.size ?? 0, this.heldWidth.get(key) ?? 0);
		const wanted = this.of.moving
			? this.unpicturedNear(left, top, w * 2, h * 2, holds).map((card) => ({ key: pictureKey(card.path), width: ladder[0]! }))
			: upgrades(
					near.map((card) => ({ key: pictureKey(card.path), x: card.x, y: card.y, w: card.w, h: card.h })),
					holds,
					this.of.camera,
					globalThis.devicePixelRatio || 1,
					ladder,
				);
		const budget = this.budgetBytes();
		let total = this.heldBytes();
		for (const { key, width } of wanted) {
			const card = byKey.get(key)!;
			// A higher rung only while it fits: else the next rest would shrink it again (`fitPictures`), and fetch it at every rest.
			const now = this.pictureBytes.get(key) ?? 0;
			const after = total - now + this.rungBytes(width, card);
			if (now > 0 && after > budget) continue;
			total = after;
			this.picturesAsked.delete(key);
			// Compressed for the GPU where it takes them (`putCompressedPicture`): written as it comes, a quarter of the memory.
			const astc = this.of.page.compressedPictures() ? "&astc=1" : "";
			const source = card.picture!;
			this.fetchPicture(key, `${source}${source.includes("?") ? "&" : "?"}w=${width}${astc}`, true, source, width);
		}
	}

	/**
	 * Of the cards that may hold nothing (`unpictured`), those near the window and fetchable; a key found
	 * holding something, or whose card is gone, leaves the set here, so the set empties as pictures come.
	 */
	private unpicturedNear(left: number, top: number, w: number, h: number, holds: (key: string) => number): SceneCard[] {
		const out: SceneCard[] = [];
		for (const key of this.unpictured) {
			const card = this.cardByKey.get(key);
			if (!card || holds(key) > 0) {
				this.unpictured.delete(key);
				continue;
			}
			if (!fetchable(card)) continue;
			if (card.x + card.w < left || card.x > left + w || card.y + card.h < top || card.y > top + h) continue;
			out.push(card);
		}
		return out;
	}

	/** About what a card's picture at a rung holds on the GPU, its smaller sizes included: a byte a pixel compressed, four plain. */
	private rungBytes(width: number, card: { w: number; h: number }): number {
		const pixels = width * width * (card.h / Math.max(card.w, 1));
		return Math.round(pixels * (this.of.page?.compressedPictures() ? 1 : 4) * (4 / 3));
	}

	private heldBytes(): number {
		let total = 0;
		for (const bytes of this.pictureBytes.values()) total += bytes;
		return total;
	}

	/** `knobs.pictureMB` changes it, for measuring. */
	private budgetBytes(): number {
		return (knobs.pictureMB ?? this.pictures.budgetMB) * 2 ** 20;
	}

	/**
	 * Card pictures within this device's budget (`device.ts`, `PICTURES`), at rest. Over it, the
	 * pictures of the cards farthest from the window are shrunk on the GPU to their next size down,
	 * a quarter of the memory each time, with no fetch and no copy from the page; cards in the window
	 * only once every other is as small as it goes. Every card keeps a picture, so one coming back into
	 * view shows at once, and goes up its ladder again at the next rest if it fits (`wantCardPictures`).
	 */
	private fitPictures(): void {
		if (!this.of.view.width || !this.of.page) return;
		const budget = this.budgetBytes();
		let total = this.heldBytes();
		if (total <= budget) return;
		const w = this.of.view.width / this.of.camera.zoom;
		const h = this.of.view.height / this.of.camera.zoom;
		const left = this.of.camera.x - w / 2;
		const top = this.of.camera.y - h / 2;
		const far = (card: SceneCard) => Math.hypot(Math.max(card.x - this.of.camera.x, 0, this.of.camera.x - (card.x + card.w)), Math.max(card.y - this.of.camera.y, 0, this.of.camera.y - (card.y + card.h)));
		const seen = (card: SceneCard) => card.x < left + w && card.x + card.w > left && card.y < top + h && card.y + card.h > top;
		const held = this.of.cardLayer.placedCards.filter((card) => this.pictureBytes.has(pictureKey(card.path)));
		held.sort((a, b) => Number(seen(a)) - Number(seen(b)) || far(b) - far(a));
		let shrank = false;
		// Round after round, each a size down, until the total fits or nothing has a smaller size.
		for (let more = true; total > budget && more; ) {
			more = false;
			for (const card of held) {
				if (total <= budget) break;
				const key = pictureKey(card.path);
				const size = this.of.page.shrinkPicture(key);
				if (!size) continue;
				const now = Math.round(size[0]! * size[1]! * (this.compressedSize.has(key) ? 1 : 4) * (4 / 3));
				total -= this.pictureBytes.get(key)! - now;
				this.pictureBytes.set(key, now);
				this.heldWidth.set(key, size[0]!);
				more = shrank = true;
			}
		}
		if (shrank) this.of.frames.draw();
	}

	/** `fitPictures` once the camera has rested `REST_MS`: a pan collects pictures as a zoom does. */
	fitSoon(): void {
		clearTimeout(this.fitTimer);
		this.fitTimer = setTimeout(() => {
			if (this.of.disposed || this.of.moving) return;
			this.fitPictures();
		}, REST_MS);
	}

	/** Image fills and card pictures by their address, and icons (`icon:<key>`): fetched once for both engines. */
	wantPictures(urls: readonly string[]): void {
		for (const url of urls) {
			if (url.startsWith("icon:")) this.of.faces.fetchIcon(url.slice(5));
			else if (!this.picturesAsked.has(url)) {
				const address = pictureAddress(url, this.of.base || location.href);
				// `__picturesOnPage`: fetched and decoded here, twice, as before, for measuring the two in one page.
				if ((globalThis as { __picturesOnPage?: boolean }).__picturesOnPage || !this.of.worker) this.fetchPicture(url, address, false);
				else {
					// The worker fetches and decodes it, and hands it here (`picture`, `receive`).
					this.picturesAsked.set(url, { url: address, source: url, tries: 0 });
					this.of.post({ type: "fetchPicture", url, address: new URL(address, location.href).href, max: this.maxPicture });
				}
			}
		}
	}

	private putPaced(put: () => void): void {
		this.putQueue.push(put);
		this.putFrame ||= requestAnimationFrame(this.putSome);
	}

	/** Ask again for a picture the server answered with a stand-in while it makes it. */
	private retryStandIn(key: string, url: string, card: boolean, asked: { source: string; size?: number | undefined }): void {
		if (this.of.disposed || this.picturesAsked.get(key) !== asked) return;
		this.fetchPicture(key, url, card, asked.source, asked.size);
	}

	private fetchPicture(key: string, url: string, card: boolean, source = url, size?: number): void {
		const asked = this.picturesAsked.get(key) ?? { url, source, tries: 0, size };
		this.picturesAsked.set(key, asked);
		if (this.fetching >= FETCHES) {
			setTimeout(() => {
				if (this.picturesAsked.get(key) !== asked) return;
				this.picturesAsked.delete(key);
				if (card) this.unpictured.add(key);
				// A card's is asked for again with the cards in view; an image fill's by its address
				// (the worker's asking again for it may have come while this one waited, and been let go).
				if (card) this.wantCardPictures();
				else this.wantPictures([key]);
			}, 200);
			return;
		}
		this.fetching++;
		void fetch(url, { credentials: "same-origin" })
			.then(async (response) => {
				// The host has no copy and no source: painted as its placeholder, saying so, and not asked again.
				if (card && saysMissing(response)) {
					const path = this.cardByKey.get(key)?.path;
					if (path) markMissing(path);
					return;
				}
				if (!response.ok) throw new Error(String(response.status));
				const standIn = response.headers.get("X-Decks-Stand-In") === "1";
				if (card && response.headers.get("Content-Type")?.startsWith("application/vnd.decks.astc")) {
					const packed = readCompressed(new Uint8Array(await response.arrayBuffer()));
					if (!packed || this.of.disposed || !this.of.page || this.picturesAsked.get(key) !== asked) return;
					this.putPaced(() => {
						if (this.of.disposed || !this.of.page || this.picturesAsked.get(key) !== asked) return;
						if (!this.of.page.putCompressedPicture(key, packed.data, packed.width, packed.height, packed.spans)) return;
						this.pictureBytes.set(key, packed.bytes);
						this.heldWidth.set(key, packed.width);
						this.picturesPut++;
						this.compressedPut++;
						this.compressedSize.set(key, [packed.width, packed.height]);
						this.of.tiles.fadeSoon();
					});
					return;
				}
				const blob = await response.blob();
				// No wider than the rung asked for, even from a server that sends the whole picture whatever `w=` says (Studio's).
				const { bitmap: forPage, width, height } = await this.picture(blob, card ? size : undefined);
				// Asked again since (a higher rung, an engine started again): this one is not wanted.
				const wanted = () => !this.of.disposed && !!this.of.page && this.picturesAsked.get(key) === asked;
				if (!wanted()) return forPage.close();
				const put = () => {
					if (!wanted()) return forPage.close();
					// What it holds on the GPU, read before the engine closes the bitmap (`fitPictures`).
					if (card) {
						// With its smaller sizes, a third again.
						this.pictureBytes.set(key, Math.round(forPage.width * forPage.height * 4 * (4 / 3)));
						this.heldWidth.set(key, forPage.width);
						this.compressedSize.delete(key);
					}
					try {
						this.of.page!.putPicture(key, forPage, width, height);
					} catch (error) {
						// The engine's, not the network's: asking again would fail the same way.
						forPage.close();
						return this.of.recover(error, `the picture ${key}`);
					}
					this.picturesPut++;
					if (card) this.of.tiles.fadeSoon();
					else this.of.frames.draw();
				};
				// A card's picture waits its turn to the GPU (`putPaced`); an image fill is needed by the worker's tiles now.
				if (card) {
					this.putPaced(put);
					if (standIn && asked.tries++ < STAND_IN_TRIES) setTimeout(() => this.retryStandIn(key, url, card, asked), STAND_IN_RETRY_MS);
					return;
				}
				put();
				// An image fill is drawn by the worker's tiles too.
				const { bitmap: forWorker } = await this.picture(blob);
				this.of.post({ type: "picture", url: key, bitmap: forWorker, width, height }, [forWorker]);
				this.of.layout.laidOut();
				if (standIn && asked.tries++ < STAND_IN_TRIES) setTimeout(() => this.retryStandIn(key, url, card, asked), STAND_IN_RETRY_MS);
			})
			.catch(() => {
				// Not reachable now (a shot that failed, the network): drawn without it, as an empty place,
				// and asked again later, a little longer each time, while nothing newer has been asked for.
				const wait = PICTURE_RETRY_MS[asked.failed ?? 0];
				if (wait === undefined) return;
				asked.failed = (asked.failed ?? 0) + 1;
				setTimeout(() => {
					if (!this.of.disposed && this.picturesAsked.get(key) === asked) this.fetchPicture(key, url, card, asked.source, asked.size);
				}, wait);
			})
			.finally(() => {
				this.fetching--;
			});
	}

	/**
	 * The drawing laid out for the pictures the worker handed over, once for those that came close
	 * together: each one laid the whole drawing out again and read it back (3 ms and more on 2,000 items).
	 */
	layOutPicturesSoon(): void {
		if (this.picturesTimer !== undefined) return;
		this.picturesTimer = setTimeout(() => {
			this.picturesTimer = undefined;
			if (this.of.disposed || !this.of.page) return;
			if (this.of.page.layOutPictures()) this.of.layout.laidOut();
			this.of.frames.draw();
		}, PICTURES_BATCH_MS);
	}

	/**
	 * A picture's bitmap, premultiplied, no bigger across than the device keeps one, and its own size
	 * (`width` × `height`, which lays it out).
	 */
	private async picture(blob: Blob, wide?: number): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
		const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "premultiply" });
		const { width, height } = bitmap;
		const fit = Math.min(1, this.maxPicture / Math.max(width, height, 1), wide ? wide / Math.max(width, 1) : 1);
		if (fit >= 1) return { bitmap, width, height };
		const resizeWidth = Math.max(1, Math.floor(width * fit));
		const resizeHeight = Math.max(1, Math.floor(height * fit));
		// From the file again, not from `bitmap`: WebKit's WebGL takes a bitmap made from a bitmap as
		// straight and premultiplies it a second time (every partly clear pixel too dark).
		bitmap.close();
		const smaller = await createImageBitmap(blob, { premultiplyAlpha: "premultiply", resizeWidth, resizeHeight, resizeQuality: "high" });
		return { bitmap: smaller, width, height };
	}
}

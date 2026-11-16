/**
 * Pictures and fonts for both engines: card pictures fetched at the size they are drawn and held to
 * a budget, image fills, icons, and the font files the drawing's words need.
 */
import type { Font, StageEngine as Engine } from "./engine.ts";
import type { SceneCard } from "./types.ts";
import { upgrades } from "./picture-ladder.ts";
import { knobs } from "../debug.ts";
import { pictureAddress } from "../host/host.ts";
import { markMissing, saysMissing } from "../items/missing.ts";
import { iconUrl, parseIcon } from "../look/icons.ts";
import { type FontFile, fontFiles, type FontNeed, isFallbackFamily, stageFontNeeds } from "../look/font-files.ts";
import { baseTheme } from "@decks/pen";

/** What a card's picture is held under in both engines: `card:<path>` (`CardPlace` in the Rust engine). */
export const pictureKey = (path: string) => `card:${path}`;

/** A card whose picture can be fetched: it names one by address, and is not a live page still loading. */
export const fetchable = (card: SceneCard) => !!card.picture && !(card.live && !card.ready) && /^(https?:|\/)/.test(card.picture);

/** How long the camera rests before the pictures are held to their budget (`fitPictures`). */
export const REST_MS = 250;

// Card pictures: the size each is drawn at, and the budget they are held to.
/**
 * Fetch the pictures of the cards near the window, each at the rung of this device's ladder its
 * drawn width needs (`picture-ladder.ts`). While the camera moves only a card with no picture is
 * fetched, at the bottom rung: nothing is fetched to sharpen a picture mid-gesture, and the GPU's
 * smaller sizes of what is held cover a zoom out. At rest each card wanting a higher rung than it
 * holds is fetched again, nearest the screen's middle first, while it fits the budget; the lower
 * picture stays drawn until the higher one replaces it.
 */
export function wantCardPictures(e: Engine): void {
	if (!e.page || !e.view.width) return;
	const w = e.view.width / e.camera.zoom;
	const h = e.view.height / e.camera.zoom;
	const left = e.camera.x - w;
	const top = e.camera.y - h;
	// What a camera step wants is found from `unpictured` alone (`unpicturedNear`): the index is asked only at rest.
	if (e.moving && e.unpictured.size === 0) return;
	// The cards near the window, from the index `setCards` keeps (built from these cards, in their order).
	const near = e.moving
		? []
		: (e.indexed !== e.placedCards ? e.placedCards : e.cardIndex.search({ x: left, y: top, w: w * 2, h: h * 2 }).map((at) => e.placedCards[at]!)).filter((card) => fetchable(card) && !(card.x + card.w < left || card.x > left + w * 2 || card.y + card.h < top || card.y > top + h * 2));
	const ladder = e.pictures.ladder;
	const byKey = e.moving ? e.cardByKey : new Map(near.map((card) => [pictureKey(card.path), card]));
	// What a card holds or is fetching: the rung asked, or the width on the GPU, whichever is more.
	const holds = (key: string) => Math.max(e.picturesAsked.get(key)?.size ?? 0, e.heldWidth.get(key) ?? 0);
	const wanted = e.moving
		? e.unpicturedNear(left, top, w * 2, h * 2, holds).map((card) => ({ key: pictureKey(card.path), width: ladder[0]! }))
		: upgrades(
				near.map((card) => ({ key: pictureKey(card.path), x: card.x, y: card.y, w: card.w, h: card.h })),
				holds,
				e.camera,
				globalThis.devicePixelRatio || 1,
				ladder,
			);
	const budget = e.budgetBytes();
	let total = e.heldBytes();
	for (const { key, width } of wanted) {
		const card = byKey.get(key)!;
		// A higher rung only while it fits: else the next rest would shrink it again (`fitPictures`), and fetch it at every rest.
		const now = e.pictureBytes.get(key) ?? 0;
		const after = total - now + e.rungBytes(width, card);
		if (now > 0 && after > budget) continue;
		total = after;
		e.picturesAsked.delete(key);
		// Compressed for the GPU where it takes them (`putCompressedPicture`): written as it comes, a quarter of the memory.
		const astc = e.page.compressedPictures() ? "&astc=1" : "";
		const source = card.picture!;
		e.fetchPicture(key, `${source}${source.includes("?") ? "&" : "?"}w=${width}${astc}`, true, source, width);
	}
}

/** Pictures fetched at once, and a stand-in picture asked for again this often, this many times. */
export const FETCHES = 6;

export const STAND_IN_RETRY_MS = 1200;

export const STAND_IN_TRIES = 50;

/** How long to wait before asking again for a picture that did not load, each time it fails again. */
export const PICTURE_RETRY_MS = [2000, 5000, 15000, 30000, 60000];

/** Pictures from the worker that come within this long of the first are laid out for together. */
export const PICTURES_BATCH_MS = 16;

/**
 * Of the cards that may hold nothing (`unpictured`), those near the window and fetchable; a key found
 * holding something, or whose card is gone, leaves the set here, so the set empties as pictures come.
 */
export function unpicturedNear(e: Engine, left: number, top: number, w: number, h: number, holds: (key: string) => number): SceneCard[] {
	const out: SceneCard[] = [];
	for (const key of e.unpictured) {
		const card = e.cardByKey.get(key);
		if (!card || holds(key) > 0) {
			e.unpictured.delete(key);
			continue;
		}
		if (!fetchable(card)) continue;
		if (card.x + card.w < left || card.x > left + w || card.y + card.h < top || card.y > top + h) continue;
		out.push(card);
	}
	return out;
}

/** About what a card's picture at a rung holds on the GPU, its smaller sizes included: a byte a pixel compressed, four plain. */
export function rungBytes(e: Engine, width: number, card: { w: number; h: number }): number {
	const pixels = width * width * (card.h / Math.max(card.w, 1));
	return Math.round(pixels * (e.page?.compressedPictures() ? 1 : 4) * (4 / 3));
}

export function heldBytes(e: Engine): number {
	let total = 0;
	for (const bytes of e.pictureBytes.values()) total += bytes;
	return total;
}

/** `knobs.pictureMB` changes it, for measuring. */
export function budgetBytes(e: Engine): number {
	return (knobs.pictureMB ?? e.pictures.budgetMB) * 2 ** 20;
}

/**
 * Card pictures within this device's budget (`device.ts`, `PICTURES`), at rest. Over it, the
 * pictures of the cards farthest from the window are shrunk on the GPU to their next size down,
 * a quarter of the memory each time, with no fetch and no copy from the page; cards in the window
 * only once every other is as small as it goes. Every card keeps a picture, so one coming back into
 * view shows at once, and goes up its ladder again at the next rest if it fits (`wantCardPictures`).
 */
export function fitPictures(e: Engine): void {
	if (!e.view.width || !e.page) return;
	const budget = e.budgetBytes();
	let total = e.heldBytes();
	if (total <= budget) return;
	const w = e.view.width / e.camera.zoom;
	const h = e.view.height / e.camera.zoom;
	const left = e.camera.x - w / 2;
	const top = e.camera.y - h / 2;
	const far = (card: SceneCard) => Math.hypot(Math.max(card.x - e.camera.x, 0, e.camera.x - (card.x + card.w)), Math.max(card.y - e.camera.y, 0, e.camera.y - (card.y + card.h)));
	const seen = (card: SceneCard) => card.x < left + w && card.x + card.w > left && card.y < top + h && card.y + card.h > top;
	const held = e.placedCards.filter((card) => e.pictureBytes.has(pictureKey(card.path)));
	held.sort((a, b) => Number(seen(a)) - Number(seen(b)) || far(b) - far(a));
	let shrank = false;
	// Round after round, each a size down, until the total fits or nothing has a smaller size.
	for (let more = true; total > budget && more; ) {
		more = false;
		for (const card of held) {
			if (total <= budget) break;
			const key = pictureKey(card.path);
			const size = e.page.shrinkPicture(key);
			if (!size) continue;
			const now = Math.round(size[0]! * size[1]! * (e.compressedSize.has(key) ? 1 : 4) * (4 / 3));
			total -= e.pictureBytes.get(key)! - now;
			e.pictureBytes.set(key, now);
			e.heldWidth.set(key, size[0]!);
			more = shrank = true;
		}
	}
	if (shrank) e.draw();
}

/** `fitPictures` once the camera has rested `REST_MS`: a pan collects pictures as a zoom does. */
export function fitSoon(e: Engine): void {
	clearTimeout(e.fitTimer);
	e.fitTimer = setTimeout(() => {
		if (e.disposed || e.moving) return;
		e.fitPictures();
	}, REST_MS);
}

/** Image fills and card pictures by their address, and icons (`icon:<key>`): fetched once for both engines. */
export function wantPictures(e: Engine, urls: readonly string[]): void {
	for (const url of urls) {
		if (url.startsWith("icon:")) e.fetchIcon(url.slice(5));
		else if (!e.picturesAsked.has(url)) {
			const address = pictureAddress(url, e.base || location.href);
			// `__picturesOnPage`: fetched and decoded here, twice, as before, for measuring the two in one page.
			if ((globalThis as { __picturesOnPage?: boolean }).__picturesOnPage || !e.worker) e.fetchPicture(url, address, false);
			else {
				// The worker fetches and decodes it, and hands it here (`picture`, `receive`).
				e.picturesAsked.set(url, { url: address, source: url, tries: 0 });
				e.post({ type: "fetchPicture", url, address: new URL(address, location.href).href, max: e.maxPicture });
			}
		}
	}
}

// Fetching a picture and handing it to both engines.
/** What a picture was asked for with, kept while it is fetched and asked again. */
type Asked = NonNullable<ReturnType<Engine["picturesAsked"]["get"]>>;

export function fetchPicture(e: Engine, key: string, url: string, card: boolean, source = url, size?: number): void {
	const asked = e.picturesAsked.get(key) ?? { url, source, tries: 0, size };
	e.picturesAsked.set(key, asked);
	if (e.fetching >= FETCHES) {
		setTimeout(() => {
			if (e.picturesAsked.get(key) !== asked) return;
			e.picturesAsked.delete(key);
			if (card) e.unpictured.add(key);
			// A card's is asked for again with the cards in view; an image fill's by its address
			// (the worker's asking again for it may have come while this one waited, and been let go).
			if (card) e.wantCardPictures();
			else e.wantPictures([key]);
		}, 200);
		return;
	}
	fetchNow(e, key, url, card, asked, size);
}

/** Fetch a picture now, one of `FETCHES` at once, and hand what comes to both engines; asked again
 * later, a little longer each time, when it does not come. */
function fetchNow(e: Engine, key: string, url: string, card: boolean, asked: Asked, size: number | undefined): void {
	e.fetching++;
	void fetch(url, { credentials: "same-origin" })
		.then(async (response) => {
			// The host has no copy and no source: painted as its placeholder, saying so, and not asked again.
			if (card && saysMissing(response)) {
				const path = e.cardByKey.get(key)?.path;
				if (path) markMissing(path);
				return;
			}
			if (!response.ok) throw new Error(String(response.status));
			const standIn = response.headers.get("X-Decks-Stand-In") === "1";
			if (card && response.headers.get("Content-Type")?.startsWith("application/vnd.decks.astc")) {
				const packed = readCompressed(new Uint8Array(await response.arrayBuffer()));
				if (!packed || e.disposed || !e.page || e.picturesAsked.get(key) !== asked) return;
				e.putPaced(() => {
					if (e.disposed || !e.page || e.picturesAsked.get(key) !== asked) return;
					if (!e.page.putCompressedPicture(key, packed.data, packed.width, packed.height, packed.spans)) return;
					e.pictureBytes.set(key, packed.bytes);
					e.heldWidth.set(key, packed.width);
					e.picturesPut++;
					e.compressedPut++;
					e.compressedSize.set(key, [packed.width, packed.height]);
					e.fadeSoon();
				});
				return;
			}
			const blob = await response.blob();
			// No wider than the rung asked for, even from a server that sends the whole picture whatever `w=` says (Studio's).
			const { bitmap: forPage, width, height } = await e.picture(blob, card ? size : undefined);
			// Asked again since (a higher rung, an engine started again): this one is not wanted.
			const wanted = () => !e.disposed && !!e.page && e.picturesAsked.get(key) === asked;
			if (!wanted()) return forPage.close();
			const put = () => {
				if (!wanted()) return forPage.close();
				// What it holds on the GPU, read before the engine closes the bitmap (`fitPictures`).
				if (card) {
					// With its smaller sizes, a third again.
					e.pictureBytes.set(key, Math.round(forPage.width * forPage.height * 4 * (4 / 3)));
					e.heldWidth.set(key, forPage.width);
					e.compressedSize.delete(key);
				}
				try {
					e.page!.putPicture(key, forPage, width, height);
				} catch (error) {
					// The engine's, not the network's: asking again would fail the same way.
					forPage.close();
					return e.recover(error, `the picture ${key}`);
				}
				e.picturesPut++;
				if (card) e.fadeSoon();
				else e.draw();
			};
			// A card's picture waits its turn to the GPU (`putPaced`); an image fill is needed by the worker's tiles now.
			if (card) {
				e.putPaced(put);
				if (standIn && asked.tries++ < STAND_IN_TRIES) setTimeout(() => e.retryStandIn(key, url, card, asked), STAND_IN_RETRY_MS);
				return;
			}
			put();
			// An image fill is drawn by the worker's tiles too.
			const { bitmap: forWorker } = await e.picture(blob);
			e.post({ type: "picture", url: key, bitmap: forWorker, width, height }, [forWorker]);
			e.laidOut();
			if (standIn && asked.tries++ < STAND_IN_TRIES) setTimeout(() => e.retryStandIn(key, url, card, asked), STAND_IN_RETRY_MS);
		})
		.catch(() => {
			// Not reachable now (a shot that failed, the network): drawn without it, as an empty place,
			// and asked again later, a little longer each time, while nothing newer has been asked for.
			const wait = PICTURE_RETRY_MS[asked.failed ?? 0];
			if (wait === undefined) return;
			asked.failed = (asked.failed ?? 0) + 1;
			setTimeout(() => {
				if (!e.disposed && e.picturesAsked.get(key) === asked) e.fetchPicture(key, url, card, asked.source, asked.size);
			}, wait);
		})
		.finally(() => {
			e.fetching--;
		});
}

/**
 * A card picture compressed for the GPU, as the server sends it (`apps/server/src/boards/astc.ts`):
 * `DKA1`, width, height and the number of sizes, each size's length, then the sizes' ASTC blocks.
 * What `putCompressedPicture` takes: the bytes, and `[at, length, …]` of each size.
 */
export function readCompressed(data: Uint8Array): { data: Uint8Array; width: number; height: number; spans: Uint32Array; bytes: number } | undefined {
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

/** Ask again for a picture the server answered with a stand-in while it makes it. */
export function retryStandIn(e: Engine, key: string, url: string, card: boolean, asked: { source: string; size?: number | undefined }): void {
	if (e.disposed || e.picturesAsked.get(key) !== asked) return;
	e.fetchPicture(key, url, card, asked.source, asked.size);
}

export function putPaced(e: Engine, put: () => void): void {
	e.putQueue.push(put);
	e.putFrame ||= requestAnimationFrame(e.putSome);
}

/**
 * The drawing laid out for the pictures the worker handed over, once for those that came close
 * together: each one laid the whole drawing out again and read it back (3 ms and more on 2,000 items).
 */
export function layOutPicturesSoon(e: Engine): void {
	if (e.picturesTimer !== undefined) return;
	e.picturesTimer = setTimeout(() => {
		e.picturesTimer = undefined;
		if (e.disposed || !e.page) return;
		if (e.page.layOutPictures()) e.laidOut();
		e.draw();
	}, PICTURES_BATCH_MS);
}

/**
 * A picture's bitmap, premultiplied, no bigger across than the device keeps one, and its own size
 * (`width` × `height`, which lays it out).
 */
export async function picture(e: Engine, blob: Blob, wide?: number): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
	const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "premultiply" });
	const { width, height } = bitmap;
	const fit = Math.min(1, e.maxPicture / Math.max(width, height, 1), wide ? wide / Math.max(width, 1) : 1);
	if (fit >= 1) return { bitmap, width, height };
	const resizeWidth = Math.max(1, Math.floor(width * fit));
	const resizeHeight = Math.max(1, Math.floor(height * fit));
	// From the file again, not from `bitmap`: WebKit's WebGL takes a bitmap made from a bitmap as
	// straight and premultiplies it a second time (every partly clear pixel too dark).
	bitmap.close();
	const smaller = await createImageBitmap(blob, { premultiplyAlpha: "premultiply", resizeWidth, resizeHeight, resizeQuality: "high" });
	return { bitmap: smaller, width, height };
}

// A gesture's preview.
// Icons and fonts.
export function fetchIcon(e: Engine, key: string): void {
	if (e.iconsAsked.has(key)) return;
	e.iconsAsked.add(key);
	const [library = "lucide", name = "", weight = "400"] = key.split("|");
	const url = iconUrl(library, name, Number(weight));
	if (!url) return;
	void fetch(url)
		.then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
		.then((svg) => {
			const shape = parseIcon(svg, Number(weight));
			if (!shape || !e.page) return;
			const json = JSON.stringify(shape);
			e.page.putIcon(key, json);
			e.post({ type: "icon", key, shape: json });
			e.draw();
		})
		.catch(() => {
			/* An icon that does not load is not drawn. */
		});
}

/** Fetch the font files the stage's words need (`font-files.ts`), and hand each to both engines in the chain's order. */
export function needFonts(e: Engine): void {
	if (!e.page) return;
	// The words of what was laid out again since the last time: a change brings only its own.
	e.fetchFonts(fontFiles(JSON.parse(e.page.fontNeedsChanged()) as FontNeed[]));
}

/**
 * Before the engine is up: the files the drawing's words name, read from the drawing here, so
 * they are on their way while the engine loads and lays out rather than asked for after. What
 * the engine's own reading (`needFonts`) finds besides is fetched then.
 */
export function prefetchFonts(e: Engine): void {
	if (e.page || e.prefetched || !e.doc) return;
	e.prefetched = true;
	const doc = e.doc;
	const files = fontFiles(stageFontNeeds(doc.children ?? [], doc, baseTheme(doc, e.scheme === "dark" ? "dark" : "light")));
	e.fetchFonts(files);
}

export function fetchFonts(e: Engine, wanted: readonly FontFile[]): void {
	const files = wanted.filter((file) => !e.fontsAsked.has(file.key));
	if (!files.length) return;
	for (const file of files) e.fontsAsked.add(file.key);
	e.fontsPending += files.length;
	// A worker still painting its first view waits for them (up to 300 ms) rather than paint it twice.
	if (e.worker) e.post({ type: "fontsDue" });
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
		e.fontsPending -= files.length;
		for (const file of files) e.fontsSettled.add(file.key);
		// Kept first: an engine started (or started again) is given them from here.
		const fonts: Font[] = loaded.filter((one) => one !== undefined).map((one) => ({ family: one.file.family, blob: one.blob, bytes: one.bytes, fallback: isFallbackFamily(one.file.family) }));
		e.fonts.push(...fonts);
		if (!e.page || e.disposed) return;
		e.giveFonts(fonts, true);
		e.postFonts(fonts);
	});
}

/**
 * Fonts to the page's engine, in the order the chain lists them (so fallbacks are tried in the
 * app's order), laid out once for all of them; `show` lays the stage out for the stage and draws.
 */
export function giveFonts(e: Engine, fonts: readonly Font[], show: boolean): void {
	if (!e.page || !fonts.length) return;
	for (const { family, bytes, fallback } of fonts) if (bytes) e.page.addFont(family, bytes, fallback, true);
	e.page.layOut();
	e.wordsGeneration++;
	if (!show) return;
	e.laidOut();
	e.draw();
}

/**
 * The same fonts to the worker, in one message (none, when every file failed: it hears how many
 * are still due): it lays out and paints once for all of them. Their bytes are transferred, not
 * copied (the page's engine has copied them already); the files are kept.
 */
export function postFonts(e: Engine, fonts: readonly Font[]): void {
	const sent = fonts.filter((font): font is Font & { bytes: Uint8Array } => !!font.bytes);
	e.post({ type: "fonts", fonts: sent.map(({ family, bytes, fallback }) => ({ name: family, bytes, fallback })), due: e.fontsPending }, sent.map((font) => font.bytes.buffer as ArrayBuffer));
	for (const font of sent) delete (font as Font).bytes;
}

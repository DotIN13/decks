import { pictureUrls } from "../core/text.ts";
import { pictureAddress } from "../../base/host.ts";
import { type TextHost } from "./TextEditing.tsx";

/** What `createPictureSizes` reads of `createTextEditing` (`TextEditing.tsx`). */
export interface PictureSizesNeeds {
	readonly host: TextHost;
}

/** How large each picture in a card's words is, measured once, so the words are laid out round it. */
export function createPictureSizes(d: PictureSizesNeeds) {
	/** Pictures' own sizes, as they arrive, so a picture put in a card keeps its shape. */
	const pictureSizes = new Map<string, { w: number; h: number } | null>();

	const pictureSize = (url: string) => pictureSizes.get(url) ?? undefined;

	const measurePictures = async (markdown: string) => {
		const urls = pictureUrls(markdown).filter((url) => !pictureSizes.has(url));
		await Promise.all(
			urls.map(
				(url) =>
					new Promise<void>((done) => {
						const image = new Image();
						const finish = (size: { w: number; h: number } | null) => {
							pictureSizes.set(url, size);
							done();
						};
						image.onload = () => finish(image.naturalWidth ? { w: image.naturalWidth, h: image.naturalHeight } : null);
						image.onerror = () => finish(null);
						setTimeout(() => finish(null), 1500);
						try {
							image.src = pictureAddress(url, new URL(d.host.pen()?.base || "/", location.origin).href);
						} catch {
							finish(null);
						}
					}),
			),
		);
	};

	return {
		pictureSize,
		measurePictures,
	};
}

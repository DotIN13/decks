import type { DocSync } from "../client.ts";
import type { DocPageOptions } from "./page.ts";
import { dir } from "./ui.ts";

/**
 * The pictures a markdown or LaTeX page shows, by the path the text gives them (beside the file
 * unless it starts at the root): read once each and kept, a PDF figure drawn as a picture.
 */
export function assetLoaders(options: DocPageOptions, sync: DocSync) {
	const urls = new Map<string, Promise<string | undefined>>();
	const pictures = new Map<string, Promise<string | undefined>>();
	const near = (src: string) => (src.startsWith("/") ? src : `${dir(sync.path)}/${decodeURI(src)}`);
	return {
		asset: (src: string) => {
			if (!options.file) return Promise.resolve(undefined);
			const path = near(src);
			let url = urls.get(path);
			if (!url) {
				url = options
					.file(path)
					.then((bytes) => URL.createObjectURL(new Blob([bytes])))
					.catch(() => undefined);
				urls.set(path, url);
			}
			return url;
		},
		pdfPicture: (src: string) => {
			if (!options.file || !options.pdf) return Promise.resolve(undefined);
			const path = near(src);
			let url = pictures.get(path);
			if (!url) {
				const into = document.createElement("div");
				url = options
					.file(path)
					.then((bytes) => options.pdf!(into, bytes, 1200))
					.then(() => into.querySelector("img")?.src ?? into.querySelector("canvas")?.toDataURL("image/png"))
					.catch(() => undefined);
				pictures.set(path, url);
			}
			return url;
		},
		/** Let go of the pictures read for the page. */
		revoke: () => {
			for (const url of urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
		},
	};
}

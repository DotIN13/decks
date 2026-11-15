import { defineFeature, type Feature, type Kernel } from "../kernel/index.ts";
import { chromium, type Browser } from "./browser.ts";
import { pictureCalls } from "./calls.ts";
import { machine, type Machine } from "./machine.ts";
import { pictureRoute } from "./picture.ts";
import { tileRoute } from "./tile.ts";
import { shotRoute } from "./download.ts";
import { snapshotRoute } from "./snapshot.ts";
import { Extents, extentRoute } from "./extent.ts";

// The pictures feature: card.fit, canvas.screenshot, canvas.export, and a
// card's picture at /pictures/. The browser is closed when the server stops.

export type PicturesOptions = { browser?: Browser; origin?: () => string | undefined; native?: boolean };

export function picturesFeature(options: PicturesOptions = {}): Feature {
	let kernel: Kernel | undefined;
	const browser = options.browser ?? chromium();
	const origin = options.origin ?? (() => kernel?.url());
	const m: Machine = machine(browser, origin, () => kernel, options.native ?? true);
	const extents = new Extents();
	return defineFeature({
		name: "pictures",
		calls: pictureCalls(() => m, extents),
		routes: [pictureRoute(() => m), tileRoute(() => m), shotRoute(() => m), snapshotRoute(() => m), extentRoute(extents)],
		start(given) {
			kernel = given;
			return () => {
				m.shutdown?.();
				void browser.close();
			};
		},
	});
}

export default picturesFeature();

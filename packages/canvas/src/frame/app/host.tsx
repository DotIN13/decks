import type { JSX } from "solid-js";
import { ItemFrame, type ItemLookProps, type ItemPass } from "../kind-host.tsx";
import { APP_STORE } from "../outside/stores.ts";
import type { AppSays } from "./protocol.ts";

/** The pass an app's frame holds: the app's address with its app pass in the path, which never runs out while the token behind it works. */
export type AppFramePass = ItemPass & { url: string };

/** What the page gives an app's frame: the app, by name, what to call it, and how to ask for its address. */
export interface AppFrameProps extends ItemLookProps {
	app: string;
	title: string;
	pass: (app: string) => Promise<AppFramePass>;
	/** Where the app's browser storage is kept on this page. Default: the page's own `localStorage`. */
	storage?: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
}

/**
 * An app whole, in a frame of its own on the page (`kind-host.tsx`), with the app kind inside it
 * (`guest.tsx`). What the app saves in its browser storage is kept here, on the page, under the app's
 * name: the same keys as an app on a canvas (`outside/stores.ts`), so it reads the same values there.
 */
export function AppFrame(props: AppFrameProps): JSX.Element {
	const storage = () => props.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
	const prefix = () => `${APP_STORE}${props.app}:`;
	const stored = (): Record<string, string> => {
		const out: Record<string, string> = {};
		const kept = storage();
		if (!kept) return out;
		for (let i = 0; i < kept.length; i++) {
			const key = kept.key(i);
			if (key?.startsWith(prefix())) out[key.slice(prefix().length)] = kept.getItem(key) ?? "";
		}
		return out;
	};
	return (
		<ItemFrame<unknown, AppSays, AppFramePass>
			dark={props.dark}
			foot={props.foot}
			agent={props.agent}
			kind="app"
			title={props.title}
			pass={() => props.pass(props.app)}
			start={(held) => ({ app: { name: props.app, title: props.title, url: held.url, stored: stored() } })}
			hear={(end) =>
				end.on("app-store", (data) => {
					if (data.value === null) storage()?.removeItem(prefix() + data.key);
					else storage()?.setItem(prefix() + data.key, data.value);
				})
			}
		/>
	);
}

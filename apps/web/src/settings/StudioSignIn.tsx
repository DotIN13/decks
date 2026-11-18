import Cloud from "lucide-solid/icons/cloud";
import { createSignal, Show } from "solid-js";
import { Icon } from "@decks/ui";
import { pairing } from "../connections/backend.ts";
import { notice } from "../state/notices.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { SetGroup, SetRow } from "./rows.tsx";

/**
 * Decks Studio in Settings: this harness signs in to Studio itself (`server/src/studio/login.ts`),
 * and this is where: not signed in, a short code on show, or signed in and as whom.
 *
 * From a tab on the harness's own machine, Sign in opens a tab on Studio that comes straight back:
 * signed in there already, there is nothing more to do. From any other device no tab can be sent
 * back to the harness, so it shows a short code to type on Studio instead. Studio's address is the
 * usual one unless another is typed. Sign out deletes the key: the deck stops syncing, and every
 * browser at Studio loses its way here.
 */
export function StudioGroup() {
	const [address, setAddress] = createSignal<string>();
	const [busy, setBusy] = createSignal(false);
	const studioAt = () => address() ?? pairing().studioAt ?? "";
	const hostOf = (url: string) => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	};
	/** Whether this tab is on the harness's own machine: where Studio can send a tab back to. */
	const here = () => ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) && location.protocol === "http:";
	const signIn = async () => {
		if (busy()) return;
		setBusy(true);
		// Opened now, while the press still counts, and sent on once the harness says where.
		const tab = here() ? window.open("about:blank", "_blank") : null;
		try {
			const answer = await call<{ url?: string; shown?: unknown }>("harness.studioSignIn", [{ ...(studioAt() ? { studio: studioAt() } : {}), back: location.origin }]);
			if (!answer.ok) {
				tab?.close();
				return void notice("error", answer.error);
			}
			if (answer.value?.url && tab) tab.location.href = answer.value.url;
			else {
				tab?.close();
				// No tab could be opened: the address is said, to open by hand.
				if (answer.value?.url) notice("info", `Open ${answer.value.url} to finish signing in.`);
			}
		} finally {
			setBusy(false);
		}
	};
	const minutes = (until: number) => Math.max(1, Math.round((until - Date.now()) / 60_000));
	const mark = (
		<span class="sw-mark">
			<Icon of={Cloud} size={14} />
		</span>
	);
	return (
		<SetGroup label="Decks Studio login" group="studio">
			<Show
				when={pairing().studio}
				fallback={
					<Show
						when={pairing().studioSignIn?.code}
						fallback={
							<SetRow
								lead={mark}
								title="Sign in to Decks Studio"
								sub={
									<>
										This deck's canvases sync there, and you reach your agents from anywhere.
										<Show when={pairing().studioSignIn?.failed}>{(why) => <span class="sw-studio-failed"> {why()}</span>}</Show>
									</>
								}
							>
								<input class="sw-field sw-studio-at" aria-label="Studio's address" placeholder="https://studio.decks.app" value={studioAt()} onInput={(event) => setAddress(event.currentTarget.value.trim())} spellcheck={false} />
								<button class="sw-btn" type="button" data-studio="sign-in" disabled={busy()} onClick={() => void signIn()}>
									Sign in
								</button>
							</SetRow>
						}
					>
						{(shown) => (
							<SetRow
								lead={mark}
								title={<span class="sw-studio-code">{shown().code}</span>}
								sub={
									<>
										Type this code at <span class="sw-mono">{hostOf(shown().verify)}/connect</span>, on any device signed in to Studio. It lasts {minutes(shown().expires)} more minutes.
									</>
								}
							>
								<button class="sw-btn" type="button" data-studio="open" onClick={() => window.open(shown().verify, "_blank", "noopener")}>
									Open Studio
								</button>
								<button class="sw-btn" type="button" data-studio="cancel" onClick={() => void call("harness.studioCancel").then(warnIfFailed)}>
									Cancel
								</button>
							</SetRow>
						)}
					</Show>
				}
			>
				{(studio) => (
					<SetRow
						lead={mark}
						title={studio().account?.email ? `Signed in to Decks Studio as ${studio().account!.email}` : "Signed in to Decks Studio"}
						sub={studio().env ? `${hostOf(studio().url)} · its key is set by DECKS_STUDIO_KEY` : `${hostOf(studio().url)} · this deck syncs there`}
					>
						<Show when={!studio().env}>
							<button class="sw-btn" type="button" data-tone="danger" data-studio="sign-out" title="Delete this harness's Studio key: the deck stops syncing, and every browser signed in to Studio loses its way here" onClick={() => void call("harness.unpair").then(warnIfFailed)}>
								Sign out
							</button>
						</Show>
					</SetRow>
				)}
			</Show>
		</SetGroup>
	);
}

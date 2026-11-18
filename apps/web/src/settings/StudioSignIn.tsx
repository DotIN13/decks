import Cloud from "lucide-solid/icons/cloud";
import { createSignal, Show } from "solid-js";
import { Icon } from "@decks/ui";
import { pairing } from "../connections/backend.ts";
import { notice } from "../state/notices.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { SetGroup, SetRow } from "./rows.tsx";

/**
 * Decks Studio in Settings: this harness signs in to Studio itself (`server/src/studio/login.ts`), the
 * way Claude Code signs in, and this is where: not signed in, a sign-in under way, or signed in and
 * as whom.
 *
 * Sign in opens a tab on Studio, which shows a code. When this tab is on the harness's own machine,
 * Studio's page has a button that brings the code back by itself; from any other device the person
 * copies it there and pastes it here. Studio's address is the usual one unless another is typed.
 * Sign out deletes the key: the deck stops syncing, and every browser at Studio loses its way here.
 */
export function StudioGroup() {
	const [address, setAddress] = createSignal<string>();
	const [code, setCode] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const studioAt = () => address() ?? pairing().studioAt ?? "";
	const hostOf = (url: string) => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	};
	/** Whether Studio's page can send its tab back here by itself: the sign-in was started from a tab on the harness's own machine. */
	const sendsBack = (url: string) => {
		try {
			return new URL(url).searchParams.has("redirect");
		} catch {
			return false;
		}
	};
	const signIn = async () => {
		if (busy()) return;
		setBusy(true);
		setCode("");
		// Opened now, while the press still counts, and sent on once the harness says where.
		const tab = window.open("about:blank", "_blank");
		try {
			const answer = await call<{ url?: string }>("harness.studioSignIn", [{ ...(studioAt() ? { studio: studioAt() } : {}), back: location.origin }]);
			if (!answer.ok || !answer.value?.url) {
				tab?.close();
				if (!answer.ok) notice("error", answer.error);
				return;
			}
			// No tab could be opened: the row that follows has Open Studio, to press.
			if (tab) tab.location.href = answer.value.url;
		} finally {
			setBusy(false);
		}
	};
	const paste = async () => {
		if (busy() || !code().trim()) return;
		setBusy(true);
		try {
			const answer = await call("harness.studioCode", [code().trim()]);
			if (!answer.ok) notice("error", answer.error);
			else setCode("");
		} finally {
			setBusy(false);
		}
	};
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
						when={pairing().studioSignIn?.open}
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
						{(open) => (
							<>
								<SetRow
									lead={mark}
									title="Studio is showing a code"
									sub={sendsBack(open().url) ? `At ${hostOf(open().studio)}, in the tab that opened. Press Sign it in there, or copy the code and paste it below.` : `Open Studio at ${hostOf(open().studio)}, copy the code it shows, and paste it below.`}
								>
									<button class="sw-btn" type="button" data-studio="open" onClick={() => window.open(open().url, "_blank")}>
										Open Studio
									</button>
									<button class="sw-btn" type="button" data-studio="cancel" onClick={() => void call("harness.studioCancel").then(warnIfFailed)}>
										Cancel
									</button>
								</SetRow>
								<SetRow lead={<span class="sw-mark" data-empty />} title="Code from Studio">
									<input
										class="sw-field sw-studio-code"
										aria-label="The code Studio shows"
										placeholder="ABCD-EFGH"
										maxLength={12}
										autocomplete="off"
										autocapitalize="characters"
										spellcheck={false}
										value={code()}
										onInput={(event) => setCode(event.currentTarget.value)}
										onKeyDown={(event) => event.key === "Enter" && void paste()}
									/>
									<button class="sw-btn" type="button" data-studio="paste" disabled={busy() || !code().trim()} onClick={() => void paste()}>
										Sign in
									</button>
								</SetRow>
							</>
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

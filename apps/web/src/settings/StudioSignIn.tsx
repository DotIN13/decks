import Cloud from "lucide-solid/icons/cloud";
import { createSignal, Show } from "solid-js";
import type { StudioSyncRow } from "@decks/protocol";
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
					<>
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
						<Show when={studio().sync}>{(sync) => <SyncRow sync={sync()} />}</Show>
					</>
				)}
			</Show>
		</SetGroup>
	);
}

/** "312 KB", "48 MB", "1.24 GB". */
export function bytesWords(bytes: number): string {
	if (bytes < 1e6) return `${Math.max(0, Math.round(bytes / 1e3))} KB`;
	if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
	return `${(bytes / 1e9).toFixed(2)} GB`;
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * How far this deck is in step with Studio, under the signed-in row (`HarnessSync.progress`, told as it
 * changes): syncing, with a bar for the work this pass found due and the file moving now; in step, and
 * since when; held by Studio until a time; or not syncing, and why.
 */
export function SyncRow(props: { sync: StudioSyncRow }) {
	const p = () => props.sync;
	const share = () => (p().bytes.total > 0 ? Math.min(1, p().bytes.done / p().bytes.total) : p().files.total > 0 ? p().files.done / p().files.total : 0);
	const moving = () => p().state === "syncing" || p().state === "held";
	const title = () => {
		switch (p().state) {
			case "connecting":
				return "Reaching Studio";
			case "syncing":
				// Every file due is done, and the cards' pictures are going up: they are not counted, so 100% would sit there.
				return !p().files.total ? "Syncing: checking what changed" : share() >= 1 ? "Syncing: finishing" : `Syncing, ${Math.floor(share() * 100)}%`;
			case "held":
				return "Studio asked for a wait";
			case "offline":
				return "Not syncing";
			case "synced":
				return "In step with Studio";
		}
	};
	const left = () => (p().skipped ? ` · ${p().skipped} ${p().skipped === 1 ? "file" : "files"} over 50 MB or refused, left out` : "");
	const sub = () => {
		const x = p();
		if (x.state === "offline") return `${x.error ?? "Studio could not be reached."}${x.syncedAt ? ` Last in step at ${clock(x.syncedAt)}.` : ""} It tries again by itself.`;
		if (x.state === "synced") return `${x.syncedAt ? `Since ${clock(x.syncedAt)}` : "Every canvas"}${x.canvases.total ? ` · ${x.canvases.total} ${x.canvases.total === 1 ? "canvas" : "canvases"} checked` : ""}${left()}`;
		if (x.state === "connecting") return "The first pass starts once Studio answers.";
		const done = x.files.total ? `${bytesWords(x.bytes.done)} of ${bytesWords(x.bytes.total)} · ${x.files.done} of ${x.files.total} files` : "";
		const canvases = x.canvases.total ? `${x.canvases.done} of ${x.canvases.total} canvases` : "";
		const until = x.state === "held" && x.heldUntil ? `The rest go at ${clock(x.heldUntil)}` : "";
		return [done, canvases, until].filter(Boolean).join(" · ") + left();
	};
	const now = () => {
		const at = p().now;
		if (p().state !== "syncing" || !at) return "";
		return at.path ? `${at.up === false ? "Taking" : "Sending"} ${at.canvas}/${at.path}` : `Comparing ${at.canvas}`;
	};
	return (
		<SetRow
			lead={<span class="sw-mark" data-empty />}
			title={
				<span class="sw-sync-title" data-state={p().state}>
					{title()}
				</span>
			}
			sub={
				<>
					<span class="sw-sync-sub">{sub()}</span>
					<Show when={moving() && p().files.total > 0}>
						<span class="sw-sync-bar" role="progressbar" aria-label="Sync" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(share() * 100)}>
							<span style={{ width: `${share() * 100}%` }} />
						</span>
					</Show>
					<Show when={now()}>
						<span class="sw-sync-now" title={now()}>
							{now()}
						</span>
					</Show>
				</>
			}
		/>
	);
}

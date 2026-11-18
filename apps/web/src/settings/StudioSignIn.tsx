import Cloud from "lucide-solid/icons/cloud";
import Check from "lucide-solid/icons/check";
import CircleAlert from "lucide-solid/icons/circle-alert";
import Clock from "lucide-solid/icons/clock";
import FileX from "lucide-solid/icons/file-x";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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

/** The icon and colour of each state: still, never animated. */
const LOOK: Record<StudioSyncRow["state"], { icon: typeof RefreshCw; tone: string }> = {
	connecting: { icon: RefreshCw, tone: "accent" },
	syncing: { icon: RefreshCw, tone: "accent" },
	held: { icon: Clock, tone: "warn" },
	synced: { icon: Check, tone: "ok" },
	offline: { icon: CircleAlert, tone: "danger" },
};

/**
 * How far this deck is in step with Studio, under the signed-in row (`HarnessSync.progress`, told as it
 * changes). One row that hangs from its first line: the state's icon, what is happening, and at the
 * right how far (a percentage), how long a wait has left, when it was last in step, or Try again. Under
 * it while files move, a still bar and the amounts with the speed; the file going up; and a row for the
 * files left out, which lists them when asked.
 */
export function SyncRow(props: { sync: StudioSyncRow }) {
	const p = () => props.sync;
	const [now, setNow] = createSignal(Date.now());
	const timer = setInterval(() => setNow(Date.now()), 1000);
	onCleanup(() => clearInterval(timer));
	// The speed, from how fast `sent` grew over the last few seconds of what was said.
	const seen: { at: number; sent: number }[] = [];
	const speed = createMemo(() => {
		const x = p();
		if (x.state !== "syncing") return (seen.length = 0), 0;
		seen.push({ at: x.at, sent: x.sent });
		while (seen.length > 2 && x.at - seen[0]!.at > 8000) seen.shift();
		const first = seen[0]!;
		return x.at > first.at && x.sent >= first.sent ? ((x.sent - first.sent) / (x.at - first.at)) * 1000 : 0;
	});
	const share = () => (p().bytes.total > 0 ? Math.min(1, p().bytes.done / p().bytes.total) : p().files.total > 0 ? p().files.done / p().files.total : 0);
	const moving = () => (p().state === "syncing" || p().state === "held") && p().files.total > 0;
	const amounts = () => `${bytesWords(p().bytes.done)} of ${bytesWords(p().bytes.total)} · ${p().files.done.toLocaleString()} of ${p().files.total.toLocaleString()} files`;
	const left = () => Math.max(0, Math.ceil(((p().heldUntil ?? 0) - now()) / 1000));
	const title = () => {
		switch (p().state) {
			case "connecting":
				return "Reaching Studio";
			case "syncing":
				return p().files.total ? (share() >= 1 ? "Finishing" : "Syncing to Studio") : "Checking what changed";
			case "held":
				return "Paused by Studio";
			case "offline":
				return "Not syncing";
			case "synced":
				return "In step with Studio";
		}
	};
	const sub = () => {
		const x = p();
		if (x.state === "offline") return `${x.error ?? "Studio could not be reached."} Your work is safe here, and Decks tries again by itself.${x.syncedAt ? ` Last in step at ${clock(x.syncedAt)}.` : ""}`;
		if (x.state === "synced") return `${x.canvases.total ? `${x.canvases.total} ${x.canvases.total === 1 ? "canvas" : "canvases"} checked. ` : ""}A change here goes up within a second.`;
		if (x.state === "connecting") return "The first pass starts once Studio answers.";
		if (!x.files.total) return "Comparing this deck with Studio's copy.";
		return x.state === "syncing" && speed() > 0 ? `${amounts()} · ${bytesWords(speed())}/s` : amounts();
	};
	const file = () => (p().state === "syncing" && p().now?.path ? `${p().now!.up === false ? "↓" : "↑"} ${p().now!.canvas}/${p().now!.path}` : "");
	const [listing, setListing] = createSignal(false);
	return (
		<>
			<div class="sw-sync" data-tone={LOOK[p().state].tone} data-state={p().state}>
				<span class="sw-mark sw-sync-mark">
					<Icon of={LOOK[p().state].icon} size={14} />
				</span>
				<span class="sw-sync-words">
					<span class="sw-sync-line">
						<span class="sw-name">{title()}</span>
						<Show when={p().state === "syncing" && p().files.total}>
							<span class="sw-sync-figure">{Math.floor(share() * 100)}%</span>
						</Show>
						<Show when={p().state === "held" && p().heldUntil}>
							<span class="sw-sync-figure">
								{Math.floor(left() / 60)}:{String(left() % 60).padStart(2, "0")} left
							</span>
						</Show>
						<Show when={p().state === "synced" && p().syncedAt}>
							<span class="sw-sync-when">Since {clock(p().syncedAt!)}</span>
						</Show>
						<Show when={p().state === "offline"}>
							<button class="sw-btn" type="button" data-studio="retry" onClick={() => void call("harness.studioSync").then(warnIfFailed)}>
								Try again
							</button>
						</Show>
					</span>
					<Show when={moving()}>
						<span class="sw-sync-bar" role="progressbar" aria-label="Sync" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(share() * 100)}>
							<span style={{ width: `${share() * 100}%` }} />
						</span>
					</Show>
					<span class="sw-sub">{sub()}</span>
					<Show when={p().state === "held"}>
						<span class="sw-sub">Studio limits how much one machine sends a minute and an hour. The rest go up when the wait ends; nothing is lost.</span>
					</Show>
					<Show when={file()}>
						<span class="sw-sync-file" title={file()}>
							{file()}
						</span>
					</Show>
				</span>
			</div>
			<Show when={p().skipped > 0}>
				<div class="sw-sync">
					<span class="sw-mark sw-sync-mark">
						<Icon of={FileX} size={14} />
					</span>
					<span class="sw-sync-words">
						<span class="sw-sync-line">
							<span class="sw-name">
								{p().skipped} {p().skipped === 1 ? "file" : "files"} left out
							</span>
							<Show when={p().leftOut?.length}>
								<button class="sw-btn" type="button" data-studio="left-out" onClick={() => setListing(!listing())}>
									{listing() ? "Hide" : "Show"}
								</button>
							</Show>
						</span>
						<span class="sw-sub">Over 50 MB, or refused by Studio: they stay on this machine.</span>
						<Show when={listing()}>
							<span class="sw-sync-list">
								<For each={p().leftOut}>{(path) => <span title={path}>{path}</span>}</For>
							</span>
						</Show>
					</span>
				</div>
			</Show>
		</>
	);
}

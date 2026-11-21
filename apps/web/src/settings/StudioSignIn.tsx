import Cloud from "lucide-solid/icons/cloud";
import Check from "lucide-solid/icons/check";
import CircleAlert from "lucide-solid/icons/circle-alert";
import Clock from "lucide-solid/icons/clock";
import FileX from "lucide-solid/icons/file-x";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { StudioSyncRow } from "@decks/protocol";
import { clockTime, Icon } from "@decks/ui";
import { formatBytes, formatNumber, m } from "@decks/i18n";
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
		<SetGroup label={m.settings_studio_group()} group="studio">
			<Show
				when={pairing().studio}
				fallback={
					<Show
						when={pairing().studioSignIn?.open}
						fallback={
							<SetRow
								lead={mark}
								title={m.settings_studio_sign_in_title()}
								sub={
									<>
										{m.settings_studio_sign_in_sub()}
										<Show when={pairing().studioSignIn?.failed}>{(why) => <span class="sw-studio-failed"> {why()}</span>}</Show>
									</>
								}
							>
								<input class="sw-field sw-studio-at" aria-label={m.settings_studio_address()} placeholder="https://studio.decks.app" value={studioAt()} onInput={(event) => setAddress(event.currentTarget.value.trim())} spellcheck={false} />
								<button class="sw-btn" type="button" data-studio="sign-in" disabled={busy()} onClick={() => void signIn()}>
									{m.settings_studio_sign_in()}
								</button>
							</SetRow>
						}
					>
						{(open) => (
							<>
								<SetRow
									lead={mark}
									title={m.settings_studio_showing_code()}
									sub={sendsBack(open().url) ? m.settings_studio_code_sends_back({ host: hostOf(open().studio) }) : m.settings_studio_code_copy({ host: hostOf(open().studio) })}
								>
									<button class="sw-btn" type="button" data-studio="open" onClick={() => window.open(open().url, "_blank")}>
										{m.settings_studio_open()}
									</button>
									<button class="sw-btn" type="button" data-studio="cancel" onClick={() => void call("harness.studioCancel").then(warnIfFailed)}>
										{m.settings_studio_cancel()}
									</button>
								</SetRow>
								<SetRow lead={<span class="sw-mark" data-empty />} title={m.settings_studio_code()}>
									<input
										class="sw-field sw-studio-code"
										aria-label={m.settings_studio_code_label()}
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
										{m.settings_studio_sign_in()}
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
							title={studio().account?.email ? m.settings_studio_signed_in_as({ email: studio().account!.email! }) : m.settings_studio_signed_in()}
							sub={studio().env ? m.settings_studio_env_key({ host: hostOf(studio().url) }) : m.settings_studio_syncs_there({ host: hostOf(studio().url) })}
						>
							<Show when={!studio().env}>
								<button class="sw-btn" type="button" data-tone="danger" data-studio="sign-out" title={m.settings_studio_sign_out_title()} onClick={() => void call("harness.unpair").then(warnIfFailed)}>
									{m.settings_studio_sign_out()}
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
	const amounts = () => m.settings_sync_amounts({ done: formatBytes(p().bytes.done), total: formatBytes(p().bytes.total), filesDone: formatNumber(p().files.done), filesTotal: formatNumber(p().files.total) });
	const left = () => Math.max(0, Math.ceil(((p().heldUntil ?? 0) - now()) / 1000));
	const title = () => {
		switch (p().state) {
			case "connecting":
				return m.settings_sync_connecting();
			case "syncing":
				return p().files.total ? (share() >= 1 ? m.settings_sync_finishing() : m.settings_sync_syncing()) : m.settings_sync_checking();
			case "held":
				return m.settings_sync_held();
			case "offline":
				return m.settings_sync_offline();
			case "synced":
				return m.settings_sync_synced();
		}
	};
	const sub = () => {
		const x = p();
		if (x.state === "offline") {
			const why = x.error ?? m.settings_sync_unreachable();
			return x.syncedAt ? m.settings_sync_offline_sub_since({ why, time: clockTime(x.syncedAt) }) : m.settings_sync_offline_sub({ why });
		}
		if (x.state === "synced") return x.canvases.total ? m.settings_sync_synced_sub_checked({ count: x.canvases.total }) : m.settings_sync_synced_sub();
		if (x.state === "connecting") return m.settings_sync_connecting_sub();
		if (!x.files.total) return m.settings_sync_comparing();
		return x.state === "syncing" && speed() > 0 ? m.settings_sync_with_speed({ amounts: amounts(), speed: formatBytes(speed()) }) : amounts();
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
							<span class="sw-sync-figure">{formatNumber(Math.floor(share() * 100) / 100, { style: "percent" })}</span>
						</Show>
						<Show when={p().state === "held" && p().heldUntil}>
							<span class="sw-sync-figure">
								{m.settings_sync_left({ time: `${Math.floor(left() / 60)}:${String(left() % 60).padStart(2, "0")}` })}
							</span>
						</Show>
						<Show when={p().state === "synced" && p().syncedAt}>
							<span class="sw-sync-when">{m.settings_sync_since({ time: clockTime(p().syncedAt!) })}</span>
						</Show>
						<Show when={p().state === "offline"}>
							<button class="sw-btn" type="button" data-studio="retry" onClick={() => void call("harness.studioSync").then(warnIfFailed)}>
								{m.settings_sync_retry()}
							</button>
						</Show>
					</span>
					<Show when={moving()}>
						<span class="sw-sync-bar" role="progressbar" aria-label={m.settings_sync_label()} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(share() * 100)}>
							<span style={{ width: `${share() * 100}%` }} />
						</span>
					</Show>
					<span class="sw-sub">{sub()}</span>
					<Show when={p().state === "held"}>
						<span class="sw-sub">{m.settings_sync_held_sub()}</span>
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
								{m.settings_sync_left_out({ count: p().skipped })}
							</span>
							<Show when={p().leftOut?.length}>
								<button class="sw-btn" type="button" data-studio="left-out" onClick={() => setListing(!listing())}>
									{listing() ? m.settings_sync_hide() : m.settings_sync_show()}
								</button>
							</Show>
						</span>
						<span class="sw-sub">{m.settings_sync_left_out_sub()}</span>
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

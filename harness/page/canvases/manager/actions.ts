import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { searchStages } from "../../state/canvases.ts";
import type { StageRow } from "../../state/types/index.ts";
import { FADE_MS, orderRows } from "./model.ts";

// The canvas manager's behaviour: it fades in and out, closes on Escape, marks
// the body while shown, searches and sorts, and names a new canvas in place.

export type ManagerProps = {
	stages: StageRow[];
	here: string | undefined;
	open: boolean;
	onClose: () => void;
	onPick: (name: string) => void;
	onNew: (title: string) => void;
	scheme: "light" | "dark";
	onRename: (name: string, to: string) => void;
	onDelete: (name: string) => void;
	onCopy?: (name: string) => void;
};

export function createManager(props: ManagerProps) {
	const [query, setQuery] = createSignal("");
	const [sort, setSort] = createSignal<"recent" | "az">("recent");
	const [naming, setNaming] = createSignal(false);
	const fields = { search: undefined as HTMLInputElement | undefined, name: undefined as HTMLInputElement | undefined };
	createEffect(() => {
		if (props.open) return setQuery("");
		setNaming(false);
	});
	closeOnEscape(props);
	const rows = createMemo(() => searchStages(props.stages, query()));
	const found = createMemo(() => rows().filter((one) => one.hit).length);
	const ordered = createMemo(() => orderRows(rows(), sort(), props.here));
	const open = (name: string) => {
		props.onPick(name);
		props.onClose();
	};
	const create = () => {
		const title = fields.name?.value.trim() ?? "";
		if (!title) return;
		setNaming(false);
		props.onNew(title);
		props.onClose();
	};
	return { ...fade(() => props.open), query, setQuery, sort, setSort, naming, setNaming, fields, found, ordered, searching: () => query().trim() !== "", open, create };
}

/** Escape closes the manager, unless something inside took the key first. */
function closeOnEscape(props: ManagerProps): void {
	createEffect(() => {
		if (!props.open) return;
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			props.onClose();
		};
		document.addEventListener("keydown", escape);
		onCleanup(() => document.removeEventListener("keydown", escape));
	});
}

/** Mounted while open or fading out; shown one frame after mounting, so the fade runs. */
function fade(open: () => boolean) {
	const [mounted, setMounted] = createSignal(false);
	const [shown, setShown] = createSignal(false);
	createEffect(() => {
		if (open()) {
			setMounted(true);
			requestAnimationFrame(() => requestAnimationFrame(() => (open() ? setShown(true) : setMounted(false))));
			return;
		}
		setShown(false);
		const gone = setTimeout(() => !open() && setMounted(false), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FADE_MS + 40);
		onCleanup(() => clearTimeout(gone));
	});
	createEffect(() => {
		if (!shown()) return;
		document.body.dataset.stageManager = "";
		onCleanup(() => delete document.body.dataset.stageManager);
	});
	return { mounted, shown };
}

/** A card's rename and delete: a rename ends once, so the blur that follows Enter renames nothing. */
export function createCardEdit(props: { canvas: () => StageRow; onRename: (name: string, to: string) => void }) {
	const [editing, setEditing] = createSignal(false);
	const [confirming, setConfirming] = createSignal(false);
	const edit = { input: undefined as HTMLInputElement | undefined, settled: true };
	const start = () => {
		edit.settled = false;
		setEditing(true);
	};
	const commit = () => {
		if (edit.settled) return;
		edit.settled = true;
		const to = edit.input?.value.trim() ?? "";
		setEditing(false);
		if (to && to !== props.canvas().title) props.onRename(props.canvas().name, to);
	};
	const cancel = () => {
		edit.settled = true;
		setEditing(false);
	};
	return { editing, confirming, setConfirming, edit, start, commit, cancel };
}

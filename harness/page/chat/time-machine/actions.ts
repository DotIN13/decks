import { endsPreview, previewTarget, type Act } from "./model.ts";

/** The shell's callbacks for one message's time machine. */
export interface TimeMachineCalls {
	entryId: string;
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
}

/** A row was pressed: the menu goes first, and the act follows. */
export function runAct(act: Act, calls: TimeMachineCalls, previewing: boolean, dismiss: (() => void) | undefined): void {
	dismiss?.();
	if (endsPreview(act)) calls.onPreview(null);
	if (act === "preview") calls.onPreview(previewTarget(previewing, calls.entryId));
	else if (act === "rewind") calls.onRewind(calls.entryId);
	else if (act === "fork") calls.onFork(calls.entryId);
	else calls.onRestore(calls.entryId);
}

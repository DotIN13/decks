/** What `ColorPicker` is given (`ColorPicker.tsx`). */
export interface ColorPickerProps {
	/** The field's colour: a hex, or a variable (`"$decks-text"`). */
	value: string | undefined;
	/** What a variable comes to on the canvas now, for the square and the hex; a hex is itself. */
	shown?: string | undefined;
	/** Whether the adaptive colours are offered (not for a shadow, whose colour carries its own alpha). */
	adaptive?: boolean;
	anchor: HTMLElement;
	label: string;
	onCommit: (hex: string) => void;
	/** The colour under the pointer, drawn and not saved; nothing means the drawing as it is saved. */
	onLive?: (hex?: string) => void;
	onClose: () => void;
}

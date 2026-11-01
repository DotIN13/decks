import { PROFILE } from "@decks/canvas/device";
import type { Component } from "solid-js";
import { DeskForm } from "./desk.tsx";
import { PhoneForm } from "./phone.tsx";
import { TabletForm } from "./tablet.tsx";
import type { FormParts } from "./parts.ts";

export type { FormParts };

/**
 * The composition for this device's form (`device/profile.ts`): a desk, a tablet or a phone. A window
 * narrower than a phone's (`narrow`) is arranged as a phone whatever the device, since its tools would
 * not fit as a column.
 */
export function formFor(narrow: boolean): Component<FormParts> {
	if (narrow || PROFILE.form === "phone") return PhoneForm;
	return PROFILE.form === "tablet" ? TabletForm : DeskForm;
}

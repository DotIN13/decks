import { DeskForm } from "./desk.tsx";
import type { FormParts } from "./parts.ts";

/**
 * A tablet's chrome: the desk's arrangement (`tools: column`, `zoom-bar`), the parts sized for a finger by
 * the stylesheets under the root's `data-touch` (`device/profile.ts`). Its own file, so a tablet can be
 * arranged apart from a desk without touching the desk's.
 */
export function TabletForm(props: FormParts) {
	return <DeskForm {...props} />;
}

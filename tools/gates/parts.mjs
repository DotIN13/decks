// Rule 8: a part of the page is three files: model.ts, view.tsx, actions.ts.
// A part is a folder under harness/page/<area>/ that holds a .tsx file; model.ts must not touch the DOM.
// Honest limit: until harness/page/ exists this checks nothing, and today's page (apps/web) is not counted.
import { dirname } from "node:path";
import { bump } from "./lib.mjs";

const DOM = /\b(document|window|HTMLElement|querySelector|addEventListener)\b/;

export default {
	name: "parts",
	rule: "8. A part of the page is three files: model, view, actions.",
	scan({ files, exists, read }) {
		const counts = new Map();
		const page = files.filter((f) => f.startsWith("harness/page/"));
		const parts = new Set(page.filter((f) => f.endsWith(".tsx")).map(dirname));
		for (const dir of parts) {
			for (const need of ["model.ts", "view.tsx", "actions.ts"]) if (!exists(`${dir}/${need}`)) bump(counts, `${dir}: part has no ${need}`);
			if (exists(`${dir}/model.ts`) && DOM.test(read(`${dir}/model.ts`))) bump(counts, `${dir}/model.ts: model touches the DOM`);
		}
		for (const f of page.filter((f) => f.endsWith(".tsx") && !f.endsWith("/view.tsx"))) bump(counts, `${f}: a .tsx in the page must be a part's view.tsx`);
		const notes = page.length ? [] : ["harness/page/ does not exist yet, so nothing was checked."];
		return { counts, notes: [...notes, "Not counted: today's page in apps/web, which is rebuilt rather than moved."] };
	},
};

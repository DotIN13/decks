/** A link opens in a new tab with no handle back: following it in place would unload the page. */
export function linkProps(href: string): { href: string; target: "_blank"; rel: "noreferrer" } {
	return { href, target: "_blank", rel: "noreferrer" };
}

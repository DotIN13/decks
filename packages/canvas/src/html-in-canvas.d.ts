/**
 * The two attributes Chrome's HTML-in-Canvas API adds, so JSX can write them.
 *
 * `layoutsubtree` on a canvas lays its children out without painting them; `drawable` on a
 * child is what lets `drawElementImage` take it. Solid writes `attr:`-prefixed props as plain
 * attributes, and this is the list it checks them against.
 */
import "solid-js";

declare module "solid-js" {
	namespace JSX {
		interface ExplicitAttributes {
			layoutsubtree: string;
			drawable: string;
		}
	}
}

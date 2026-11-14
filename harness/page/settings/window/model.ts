// The sections of Settings, in the order its left side lists them, and
// which opens first: the last one opened, kept in this browser.

export const SECTIONS = [
	{ id: "general", label: "General" },
	{ id: "notifications", label: "Notifications" },
	{ id: "accounts", label: "Accounts" },
	{ id: "voice", label: "Voice" },
	{ id: "connections", label: "Connections" },
	{ id: "chrome", label: "Chrome" },
] as const;

export type Section = (typeof SECTIONS)[number]["id"];
export const SECTION_KEY = "decks.settings.section";

/** The section kept, or Notifications when none is or it is not one of the six. */
export function sectionOf(kept: string | null | undefined): Section {
	return SECTIONS.some((one) => one.id === kept) ? (kept as Section) : "notifications";
}

export const labelOf = (section: Section): string => SECTIONS.find((one) => one.id === section)?.label ?? "";

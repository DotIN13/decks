/**
 * Every word Decks shows a person, in their language.
 *
 * A component writes `m.settings_title()` where it once wrote "Settings": each message is a typed
 * function Paraglide compiles from `messages/<area>/<locale>.json`, so a missing message or a wrong
 * placeholder is a type error, and a bundle carries only the messages it calls.
 *
 * The language is the person's choice in Settings (kept in this browser), else the browser's own
 * languages, else English. A change reloads the page, so every word, including those drawn once and
 * never again, is in the new language without any of them having to listen for it.
 *
 * Dates, times, numbers and "5 min ago" are the browser's `Intl`, asked in the same language.
 */
import { defineCustomClientStrategy, getLocale, locales, localStorageKey, setLocale, type Locale } from "./paraglide/runtime.js";

export { m } from "./paraglide/messages.js";
export { getLocale, locales, type Locale };

/**
 * The browser's languages, matched by language and not only by exact tag: "zh", "zh-Hans" and
 * "zh-SG" are Simplified Chinese here, as "en-GB" is English. Traditional Chinese ("zh-TW",
 * "zh-HK", "zh-Hant") is not Simplified, so it falls through to the next language the browser
 * lists, and to English.
 */
export function browserLocale(languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]): Locale | undefined {
	for (const tag of languages) {
		const lower = tag.toLowerCase();
		if (lower.startsWith("zh")) {
			if (/^zh-(tw|hk|mo)\b|hant/.test(lower)) continue;
			return "zh-CN";
		}
		if (lower === "en" || lower.startsWith("en-")) return "en";
	}
	return undefined;
}

defineCustomClientStrategy("custom-browser", { getLocale: () => browserLocale(), setLocale: () => {} });

/** A language as Settings offers it: in its own words, so a person who cannot read the current one still finds theirs. */
export const LANGUAGES: readonly { locale: Locale; name: string }[] = [
	{ locale: "en", name: "English" },
	{ locale: "zh-CN", name: "简体中文" },
];

/** What the person chose in Settings, or `undefined` when the page follows the browser. */
export function chosenLocale(): Locale | undefined {
	try {
		const kept = localStorage.getItem(localStorageKey);
		return (locales as readonly string[]).includes(kept ?? "") ? (kept as Locale) : undefined;
	} catch {
		return undefined;
	}
}

/** Choose a language, or `undefined` to follow the browser's, and reload the page in it. */
export function chooseLocale(next: Locale | undefined): void {
	if (next) return void setLocale(next);
	try {
		localStorage.removeItem(localStorageKey);
	} catch {}
	location.reload();
}

/** `<html lang>`, so the browser picks the right fonts for Chinese, hyphenates and reads aloud in the language shown. */
export function markDocumentLanguage(doc: Document = document): void {
	doc.documentElement.lang = getLocale();
}

// ── Numbers and times, in the language shown ─────────────────────────────────────────────

const cache = new Map<string, Intl.NumberFormat | Intl.RelativeTimeFormat | Intl.ListFormat>();
function cached<T extends Intl.NumberFormat | Intl.RelativeTimeFormat | Intl.ListFormat>(key: string, make: () => T): T {
	const full = `${getLocale()}|${key}`;
	let found = cache.get(full);
	if (!found) cache.set(full, (found = make()));
	return found as T;
}

/** 12,345 in English, 12,345 in Chinese too; with `options` for percentages, units and compact forms. */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
	return cached(`n${JSON.stringify(options)}`, () => new Intl.NumberFormat(getLocale(), options)).format(value);
}

/** "a, b and c", "a、b 和 c". */
export function formatList(items: readonly string[], type: Intl.ListFormatType = "conjunction"): string {
	return cached(`l${type}`, () => new Intl.ListFormat(getLocale(), { style: "long", type })).format(items);
}

/** 1.2 MB, from a count of bytes, with the unit in the language shown. */
export function formatBytes(bytes: number): string {
	const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit += 1;
	}
	return formatNumber(value, { style: "unit", unit: units[unit], unitDisplay: "short", maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 });
}

/**
 * How long ago, as a phrase: "just now", "5 min ago", "3 hr ago", "yesterday", "4 days ago"; past a
 * week, the day itself. `style` "narrow" is the shortest the language has ("5m ago", "5分钟前").
 */
export function formatAgo(at: number, now = Date.now(), style: "long" | "short" | "narrow" = "short"): string {
	const seconds = Math.round((at - now) / 1000);
	const rtf = cached(`r${style}`, () => new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto", style }));
	if (Math.abs(seconds) < 45) return rtf.format(0, "second");
	const minutes = Math.round(seconds / 60);
	if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
	const days = Math.round(hours / 24);
	if (Math.abs(days) < 7) return rtf.format(days, "day");
	return new Date(at).toLocaleDateString(getLocale(), { day: "numeric", month: "short", ...(new Date(at).getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) });
}

/** A length of time: "1 hr 5 min", "1小时5分钟". */
export function formatDuration(ms: number, style: "long" | "short" | "narrow" = "short"): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const parts = hours ? { hours, minutes } : minutes ? { minutes, ...(minutes < 10 && seconds ? { seconds } : {}) } : { seconds };
	const Duration = (Intl as unknown as { DurationFormat?: new (locale: string, options: { style: string }) => { format(value: object): string } }).DurationFormat;
	if (Duration) return new Duration(getLocale(), { style }).format(parts);
	return Object.entries(parts)
		.map(([unit, value]) => formatNumber(value, { style: "unit", unit: unit.slice(0, -1), unitDisplay: style }))
		.join(" ");
}

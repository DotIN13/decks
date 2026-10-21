/**
 * What an editor may interrupt you with when an agent finishes, asks or fails: a sound, a system
 * banner while you are elsewhere, and a count on the tab. The rules (`policy`), the cues (`sound`,
 * served by `decksSounds()` from `@decks/canvas/vite`), the banners (`notify`) and the live half
 * (`createAlerts`), shared by the Decks app and Studio.
 */
export { createAlerts, type AlertBanner } from "../alerts/alerts.ts";
export { ALERT_KINDS, ALERT_LABELS, DEFAULT_PREFS, finished, inView, loadPrefs, savePrefs, shouldNotify, shouldSound, startedAsking, tabTitle, type AlertKind, type AlertPrefs, type Presence } from "../alerts/policy.ts";
export { isSound, play, preload, setSoundBase, SILENT, SOUND_FAMILIES, SOUND_IDS, soundLabel, soundName, soundUrl, type SoundChoice, type SoundFamily } from "../alerts/sound.ts";
export { availability, post, request, type Availability, type Banner } from "../alerts/notify.ts";
export { createTabBadge } from "../alerts/tab-badge.ts";

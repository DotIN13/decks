// The page's alerts when an agent finishes, asks or fails: a cue, a system banner while
// the person is elsewhere, and a count on the tab. Moved from today's @decks/agent-ui.
export { createAlerts, type AlertBanner } from "./alerts.ts";
export { ALERT_KINDS, ALERT_LABELS, DEFAULT_PREFS, finished, inView, loadPrefs, savePrefs, shouldNotify, shouldSound, startedAsking, tabTitle, type AlertKind, type AlertPrefs, type Presence } from "./policy.ts";
export { isSound, play, preload, setSoundBase, SILENT, SOUND_FAMILIES, SOUND_IDS, soundLabel, soundName, soundUrl, type SoundChoice, type SoundFamily } from "./sound.ts";
export { availability, post, request, type Availability, type Banner } from "./notify.ts";
export { createTabBadge } from "./tab-badge.ts";

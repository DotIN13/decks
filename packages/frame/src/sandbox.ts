/**
 * What a frame may do, the one list for every frame: the canvas's, and an app's inside it, which can
 * have no more than the frame around it has.
 *
 * What asks for no prompt and reaches nothing of Decks's: a popup stays sandboxed; autoplay lets a
 * film play with sound after a click on the page. Never allow-same-origin,
 * allow-popups-to-escape-sandbox, allow-top-navigation, or payment and passkeys: what runs in a
 * frame may be served from Decks's own address, so each would hand it Decks's page or your login.
 */
export const SANDBOX = "allow-scripts allow-downloads allow-forms allow-modals allow-popups allow-pointer-lock allow-top-navigation-to-custom-protocols";

/** The features a frame is let use (`allow`), under the same rule. The microphone, the camera, the screen and the location are not among them. */
export const ALLOW = "clipboard-read; clipboard-write; fullscreen; autoplay; picture-in-picture; screen-wake-lock; web-share; gamepad; encrypted-media; accelerometer; gyroscope; xr-spatial-tracking";

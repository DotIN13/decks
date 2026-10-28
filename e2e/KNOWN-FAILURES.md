# Known failures

What fails on studio-canvas after the tidy-up of 2026-10-28, and why. Each line is an app bug a check
found, not a check that is out of date; the check is left failing (or works around it, where it says
so) until the bug is fixed. Remove a line when its fix lands.

Last full run on this Mac: 66 checks, 980 assertions passed, none failed.

## App bugs

None known.

## Not app bugs, but worth knowing

- The Rust tests' font files (`packages/stage/fonts/*.ttf`) are ignored by git and fetched by nothing.
  Without them every font-dependent test skips quietly, which is how a glyph texture bug went unseen;
  copy them from a checkout that has them.
- The camera's opening fit lands about 2.5 s after the page opens: a check that reads the camera or
  places things after a short settle can act on the camera before it.
- Playwright's `locator.click()` scrolls its target into view first, and the stage is a scroll
  container now, so it can pan the canvas under the press: press by coordinates instead.

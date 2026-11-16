# Edge cases the inline reader must keep

A footnote start with no close [^note falls through to a link [text](http://example.com).

A lone ! is plain, and !not an image either, but ![alt](pic.png) is.

One dollar $ that never closes, then $$ later, and $ before a space, then $x$ that closes.

An unmatched ``` backtick run is skipped whole, and `code` still reads.

An emphasis run ** that closes nothing, and *** another, then **bold** and *italic*.

Escapes \* and \[ and \` stay plain; <https://example.com> and <u>under</u> and <!-- a comment -->.

A bare URL https://example.com/path?x=1 and H<sub>2</sub>O and x<sup>2</sup> and <kbd>Ctrl</kbd> and <mark>marked</mark>.

# Board fonts

The two families `theme.css` names for every board, shipped so that a board looks the same
in every browser and in the server's own Chrome, which draws the boards' pictures. Before
these were here, "Inter" resolved to nothing on any machine without it installed: a Mac
drew its system font and the server drew Liberation Sans.

Both are redistributed under the SIL Open Font License 1.1, which permits bundling.

- Inter: `InterVariable.woff2`, `InterVariable-Italic.woff2`. Copyright (c) 2016 The Inter
  Project Authors, https://github.com/rsms/inter
- JetBrains Mono: `JetBrainsMono-Regular.woff2`, `-Medium`, `-Bold`, `-Italic`. Copyright
  (c) 2020 The JetBrains Mono Project Authors, https://github.com/JetBrains/JetBrainsMono

Kept out of `fonts/`, which `npm run vendor` empties and refills with KaTeX's.

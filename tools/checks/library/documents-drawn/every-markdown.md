---
title: Every construct
tags: [a, b]
---

# Heading one

## Heading two with **bold** and `code`

### Heading three
#### Heading four
##### Heading five
###### Heading six

Plain words, **bold**, *italic*, __bold too__, _italic too_, ***both***, ~~struck~~, ==marked==, and `code with **stars**`.
Nested: **bold with *italic* inside** and *italic with **bold** inside*, and ``code with a ` tick``.
Intra_word_underscores stay plain, as do 2*3*4 and a lone * star.
Escaped \*stars\*, \_underscores\_, \# a hash and \[brackets\].
Unclosed **bold and unclosed `tick stay as written.

A [link](https://example.com "with a title") and [one with **style**](https://example.com/a_b), an <https://auto.link/x>,
a bare https://example.org/path?q=1. and www.example.net, and mail <mailto:someone@example.com>.

An image ![alt words](pictures/a.png "title") and one by angle ![b](<pictures/b c.png>).

A footnote[^1] and another[^note].

[^1]: The first footnote.

Inline maths $a^2 + b^2 = c^2$, money like $5 and $10, and $x$ next to $y$.

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

> A quote with **bold**.
> - a list inside the quote
> - and a second item
>
> > A nested quote.

- One
- Two
  - Two point one
    - Two point one point one
  - Two point two
- Three

1. First
2. Second
   1. Second, first
   2. Second, second
3. Third

- [ ] A task to do
- [x] A task done

```ts
const tick = "`";
function hello(name: string) {
	return `hello ${name}`;
}
```

~~~
plain fence with tildes
~~~

| Left | Centre | Right |
|:-----|:------:|------:|
| a    | **b**  | `c`   |
| d    | [e](x) | $f$   |

<div class="note">
An HTML block.
</div>

Inline HTML: <u>underlined</u>, H<sub>2</sub>O, x<sup>2</sup>, <kbd>Ctrl</kbd>, <mark>marked</mark>, <span class="x">a span</span>, and <!-- a comment -->.

---

Last line with a trailing space 
and a hard break above.

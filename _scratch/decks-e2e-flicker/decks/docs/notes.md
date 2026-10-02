# Session notes

The refresh race is the whole problem. Two tabs, one refresh token, and the
second tab wakes up holding a token the first one has already spent.

## What we know

- The window is small — about **240ms** on a warm connection — but it is a real
  window, and a laptop waking from sleep hits it almost every time.
- Rotating on every request makes it worse, not better: more rotations, more
  windows.
- A single-flight lock in the client fixes the common case. It does not fix two
  *processes*, which is what two tabs are.

## The shape of a fix

A refresh is a claim on a token, so it should behave like one: first claim wins,
losers wait for the winner's answer instead of making their own claim. Server
side that is a short-lived lock keyed by the token family; client side it is one
promise every tab awaits.

Cost per refresh is $O(1)$ either way — the lock is a single write with a TTL, so
the added latency is one round trip for the losers and nothing for the winner.

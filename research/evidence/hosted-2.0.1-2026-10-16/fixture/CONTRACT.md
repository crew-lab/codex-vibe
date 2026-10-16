# Public synthetic comparison fixture

`exceeds(value, limit)` returns true only when value is strictly greater than limit (`value > limit`). Equality returns false. Inputs for review: (699, 700), (700, 700), (701, 700), (-3, -2), (-1, -2).

A separate future `atLeast(value, limit)` function must implement `value >= limit`; it must not modify the existing function or contract. Its module is src/at-least.mjs and its Node built-in tests are tests/at-least.test.mjs.

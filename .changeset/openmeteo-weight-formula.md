---
'@martinschmieschek/slopdogs-openmeteo': patch
---

`openMeteoCallWeight` now follows Open-Meteo's server code (`calculateQueryWeight` in `ForecastApiResult.swift`): `max(1, (variables × models / 10) × max(1, days / 14))` — the `max(1, …)` applies to the product, not to each factor. Few variables over a long period no longer count too much (5 variables over 28 days = 1, was 2). New optional third parameter `models` (default 1).

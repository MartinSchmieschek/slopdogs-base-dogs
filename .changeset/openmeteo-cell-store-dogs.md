---
'@martinschmieschek/slopdogs-dogs-solar': minor
'@martinschmieschek/slopdogs-dogs-humidity': minor
'@martinschmieschek/slopdogs-dogs-snow': minor
'@martinschmieschek/slopdogs-dogs-soil': minor
'@martinschmieschek/slopdogs-dogs-storm': minor
'@martinschmieschek/slopdogs-dogs-wind': minor
'@martinschmieschek/slopdogs-dogs-weather': minor
'@martinschmieschek/slopdogs-dogs-sun': minor
'@martinschmieschek/slopdogs-dogs-astronomy': minor
'@martinschmieschek/slopdogs-dogs-air-quality': minor
---

Open-Meteo forecast, satellite and air-quality dogs fetch through the shared Open-Meteo cell store instead of caching their own result: dogs at the same 1 km cell share one fetch and one cache entry, the cache key no longer depends on `days`. Outputs are unchanged for `days` up to 7; the forecast range is now 1-7 days (larger values are clamped to 7). Results carry an optional `stale: true` only when the Open-Meteo budget is exhausted and older stored data is served. Weather, Sun, Astronomy and Air-Quality now have `@martinschmieschek/slopdogs-openmeteo` as a peer dependency.

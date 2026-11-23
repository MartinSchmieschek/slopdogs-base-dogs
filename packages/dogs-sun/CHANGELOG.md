# @martinschmieschek/slopdogs-dogs-sun

## 0.4.0

### Minor Changes

- 7653db3: Open-Meteo forecast, satellite and air-quality dogs fetch through the shared Open-Meteo cell store instead of caching their own result: dogs at the same 1 km cell share one fetch and one cache entry, the cache key no longer depends on `days`. Outputs are unchanged for `days` up to 7; the forecast range is now 1-7 days (larger values are clamped to 7). Results carry an optional `stale: true` only when the Open-Meteo budget is exhausted and older stored data is served. Weather, Sun, Astronomy and Air-Quality now have `@martinschmieschek/slopdogs-openmeteo` as a peer dependency.

### Patch Changes

- Updated dependencies [7653db3]
  - @martinschmieschek/slopdogs-openmeteo@0.4.0

## 0.3.1

### Patch Changes

- 498e4ca: SunRetriever cacht seine Open-Meteo-Abfrage: 1-km-Zelle, Tageszahl und UTC-Datum im Schluessel, eine Stunde Haltezeit. Ungueltige Tageszahl faellt auf 7 statt `forecast_days=NaN` zu senden.

# @martinschmieschek/slopdogs-dogs-air-quality

## 0.3.1

### Patch Changes

- 498e4ca: Cache-Zelle 1 km statt 200 m: `geoBucketKey` bekam nur den Radius 1000, die Zellgroesse ergab sich daraus zu 200 m. Jetzt `bucketM: 1000` — Orte bis rund 1 km auseinander teilen sich den Eintrag, Open-Meteo rechnet ohnehin auf groeberem Raster.

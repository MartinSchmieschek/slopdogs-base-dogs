---
'@martinschmieschek/slopdogs-dogs-weather': patch
'@martinschmieschek/slopdogs-dogs-water': patch
'@martinschmieschek/slopdogs-dogs-air-quality': patch
---

Cache-Zelle 1 km statt 200 m: `geoBucketKey` bekam nur den Radius 1000, die Zellgroesse ergab sich daraus zu 200 m. Jetzt `bucketM: 1000` — Orte bis rund 1 km auseinander teilen sich den Eintrag, Open-Meteo rechnet ohnehin auf groeberem Raster.

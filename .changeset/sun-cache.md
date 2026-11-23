---
'@martinschmieschek/slopdogs-dogs-sun': patch
---

SunRetriever cacht seine Open-Meteo-Abfrage: 1-km-Zelle, Tageszahl und UTC-Datum im Schluessel, eine Stunde Haltezeit. Ungueltige Tageszahl faellt auf 7 statt `forecast_days=NaN` zu senden.

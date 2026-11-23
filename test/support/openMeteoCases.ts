/**
 * Die Faelle fuer den Vorher-Nachher-Vergleich der Open-Meteo-Dogs: je Dog eine oder zwei Queries (Tage hoechstens 7)
 * und die Szenarien der Kontingent-Messung. Die Aufzeichnung `fixtures/openMeteoBefore.json` entstand mit dem Stand
 * vor dem Zellen-Speicher (feature/dogs-humidity, 8f6fe3b) und derselben Attrappe.
 */

import { WindProfileRetriever, WindProfileQueryPact } from '@martinschmieschek/slopdogs-dogs-wind';
import {
    SoilRetriever,
    SoilQueryPact,
    EvapotranspirationRetriever,
    EvapotranspirationQueryPact,
} from '@martinschmieschek/slopdogs-dogs-soil';
import { SnowRetriever, SnowQueryPact } from '@martinschmieschek/slopdogs-dogs-snow';
import { HumidityRetriever, HumidityQueryPact } from '@martinschmieschek/slopdogs-dogs-humidity';
import { ThunderstormRetriever, ThunderstormQueryPact } from '@martinschmieschek/slopdogs-dogs-storm';
import {
    SolarRadiationRetriever,
    SolarRadiationQueryPact,
    SatelliteRadiationRetriever,
    SatelliteRadiationQueryPact,
} from '@martinschmieschek/slopdogs-dogs-solar';
import { WeatherRetriever, WeatherQueryPact } from '@martinschmieschek/slopdogs-dogs-weather';
import { SunRetriever, SunQueryPact } from '@martinschmieschek/slopdogs-dogs-sun';
import { AstronomyRetriever, AstronomyQueryPact } from '@martinschmieschek/slopdogs-dogs-astronomy';
import { AirQualityRetriever, AirQualityQueryPact } from '@martinschmieschek/slopdogs-dogs-air-quality';
import { BASE_DATE } from './openMeteoKit';

export const PADERBORN = { lat: '51.7189', lng: '8.7575' };
/** Rund 500 m noerdlich — in der Regel eine andere 1-km-Zelle. */
export const PADERBORN_NORTH = { lat: '51.7234', lng: '8.7575' };

export interface DogCase {
    id: string;
    dog: unknown;
    pact: unknown;
    query: Record<string, string>;
}

export const DOG_CASES: DogCase[] = [
    { id: 'solar-days3', dog: SolarRadiationRetriever, pact: SolarRadiationQueryPact, query: { ...PADERBORN, days: '3' } },
    { id: 'solar-days7', dog: SolarRadiationRetriever, pact: SolarRadiationQueryPact, query: { ...PADERBORN, days: '7' } },
    { id: 'satellite-default', dog: SatelliteRadiationRetriever, pact: SatelliteRadiationQueryPact, query: PADERBORN },
    { id: 'satellite-past3', dog: SatelliteRadiationRetriever, pact: SatelliteRadiationQueryPact, query: { ...PADERBORN, pastDays: '3' } },
    { id: 'humidity-default', dog: HumidityRetriever, pact: HumidityQueryPact, query: PADERBORN },
    { id: 'humidity-days2', dog: HumidityRetriever, pact: HumidityQueryPact, query: { ...PADERBORN, days: '2' } },
    { id: 'snow-default', dog: SnowRetriever, pact: SnowQueryPact, query: PADERBORN },
    { id: 'soil-default', dog: SoilRetriever, pact: SoilQueryPact, query: PADERBORN },
    { id: 'evapotranspiration-default', dog: EvapotranspirationRetriever, pact: EvapotranspirationQueryPact, query: PADERBORN },
    { id: 'thunderstorm-default', dog: ThunderstormRetriever, pact: ThunderstormQueryPact, query: PADERBORN },
    { id: 'wind-days5', dog: WindProfileRetriever, pact: WindProfileQueryPact, query: { ...PADERBORN, days: '5' } },
    { id: 'weather-now', dog: WeatherRetriever, pact: WeatherQueryPact, query: PADERBORN },
    { id: 'weather-at-14', dog: WeatherRetriever, pact: WeatherQueryPact, query: { ...PADERBORN, time: '14:00', date: '2026-11-24' } },
    { id: 'sun-default', dog: SunRetriever, pact: SunQueryPact, query: PADERBORN },
    { id: 'sun-days3', dog: SunRetriever, pact: SunQueryPact, query: { ...PADERBORN, days: '3' } },
    { id: 'astronomy-in-forecast', dog: AstronomyRetriever, pact: AstronomyQueryPact, query: { ...PADERBORN, date: '2026-11-25' } },
    { id: 'astronomy-past-date', dog: AstronomyRetriever, pact: AstronomyQueryPact, query: { ...PADERBORN, date: '2026-10-01' } },
    { id: 'air-quality', dog: AirQualityRetriever, pact: AirQualityQueryPact, query: PADERBORN },
];

/** Ein Dog einer Welle: Klasse, Pact, Query. */
export type Wave = Array<Omit<DogCase, 'id'>>;

export const energyForecast = (days: string, place = PADERBORN): Wave => [
    { dog: SolarRadiationRetriever, pact: SolarRadiationQueryPact, query: { ...place, days } },
    { dog: HumidityRetriever, pact: HumidityQueryPact, query: { ...place, days } },
    { dog: SnowRetriever, pact: SnowQueryPact, query: { ...place, days } },
];

/** Alle Dogs auf der Vorhersage-API, je mit ihren Vorgaben, an einer Zelle. */
export const allForecastDogs = (place = PADERBORN): Wave => [
    { dog: SolarRadiationRetriever, pact: SolarRadiationQueryPact, query: place },
    { dog: HumidityRetriever, pact: HumidityQueryPact, query: place },
    { dog: SnowRetriever, pact: SnowQueryPact, query: place },
    { dog: SoilRetriever, pact: SoilQueryPact, query: place },
    { dog: EvapotranspirationRetriever, pact: EvapotranspirationQueryPact, query: place },
    { dog: ThunderstormRetriever, pact: ThunderstormQueryPact, query: place },
    { dog: WindProfileRetriever, pact: WindProfileQueryPact, query: place },
    { dog: WeatherRetriever, pact: WeatherQueryPact, query: place },
    { dog: SunRetriever, pact: SunQueryPact, query: place },
    { dog: AstronomyRetriever, pact: AstronomyQueryPact, query: { ...place, date: BASE_DATE } },
];

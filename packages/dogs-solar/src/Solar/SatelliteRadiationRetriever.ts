/**
 * =========================================================================
 *  SATELLITE RADIATION RETRIEVER — gemessene Einstrahlung der letzten Stunden
 * =========================================================================
 *
 *  Kein Modell, sondern Satellitenmessung (Open-Meteo, satellite_radiation_seamless):
 *  Europa/Afrika rund 20–30 min, sonst bis 2 h verzoegert. Stunden ohne Messung
 *  (die Zukunft, Luecken) fallen weg.
 */

import { Dog, IHuntingSeason, type ICacheHandler, type ICacheable } from '@martinschmieschek/slopdogs-core';
import type { SolarRadiationResult } from './interfaces/solarTypes';
import { SatelliteRadiationQueryPact, type SatelliteRadiationQuery } from './pacts';
import {
    OPEN_METEO_SATELLITE_URL,
    clampInt,
    fetchOpenMeteo,
    openMeteoCacheKey,
    openMeteoUrl,
    parseLatLng,
    todayUtc,
    type DogClass,
} from '@martinschmieschek/slopdogs-openmeteo';
import { solarVariables, toHours, toResult } from './openMeteoSolar';

/** Neue Messungen kommen viertelstuendlich. */
const TTL_MS = 15 * 60_000;

export async function getSatelliteRadiation(lat: number, lng: number, pastDays: number): Promise<SolarRadiationResult> {
    const url = openMeteoUrl(OPEN_METEO_SATELLITE_URL, lat, lng, {
        hourly: solarVariables(false),
        models: 'satellite_radiation_seamless',
        past_days: pastDays,
        forecast_days: 1,
    });
    const data = await fetchOpenMeteo(url, 'satellite radiation');
    const measured = toHours(data, false).filter((h) => h.ghi !== null);
    return toResult(data, measured, 'satellite');
}

export class SatelliteRadiationRetriever extends Dog<SolarRadiationResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return SatelliteRadiationRetriever.name;
    }
    get description(): string {
        return 'Measured (satellite, not modelled) hourly solar irradiance GHI, DNI, DHI, direct horizontal (W/m², horizontal plane) for today and up to 7 past days, with daily kWh/m² sums. Delay ~20-30 min in Europe/Africa, up to 2 h elsewhere. Open-Meteo, cached 15 min per 1 km cell.';
    }
    get icon(): string | undefined {
        return '🛰️';
    }
    get required(): DogClass[] {
        return [SatelliteRadiationQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<SolarRadiationResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(SatelliteRadiationQueryPact, d));
        const query = (queryDog?.collected as SatelliteRadiationQuery | undefined) ?? ({} as SatelliteRadiationQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const pastDays = clampInt(query.pastDays, 1, 0, 7);

        const fetchIt = () => getSatelliteRadiation(lat, lng, pastDays);
        if (!this.cacheHandler) return fetchIt();
        const key = openMeteoCacheKey('solar-satellite', lat, lng, { pastDays, date: todayUtc() });
        return this.cacheHandler.getOrFetch(key, TTL_MS, fetchIt);
    };
}

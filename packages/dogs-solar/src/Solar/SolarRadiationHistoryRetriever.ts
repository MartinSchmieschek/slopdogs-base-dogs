/**
 * =========================================================================
 *  SOLAR RADIATION HISTORY RETRIEVER — Einstrahlung vergangener Zeitraeume
 * =========================================================================
 *
 *  Fuer Ertragsrechnungen: stuendlich GHI/DNI/DHI plus Temperatur und Wind
 *  aus dem Open-Meteo-Archiv (Reanalyse ab 1940).
 */

import { Dog, IHuntingSeason, type ICacheHandler, type ICacheable } from '@martinschmieschek/slopdogs-core';
import type { SolarRadiationResult } from './interfaces/solarTypes';
import { SolarRadiationHistoryQueryPact, type SolarRadiationHistoryQuery } from './pacts';
import {
    OPEN_METEO_ARCHIVE_URL,
    fetchOpenMeteo,
    openMeteoCacheKey,
    openMeteoUrl,
    parseLatLng,
    type DogClass,
} from '@martinschmieschek/slopdogs-openmeteo';
import { solarVariables, toHours, toResult } from './openMeteoSolar';

const DAY_MS = 24 * 60 * 60_000;
/** Das Archiv hinkt rund fuenf Tage nach; juengere Tage koennen sich noch fuellen. */
const ARCHIVE_DELAY_DAYS = 6;
/** Hoechstens ein Jahr je Abruf — Open-Meteo zaehlt je 14 Tage einen Abruf (1 Jahr ≈ 26). */
const MAX_SPAN_DAYS = 366;
/** Abgeschlossene Vergangenheit aendert sich nicht mehr. */
const TTL_SETTLED_MS = 30 * DAY_MS;
/** Zeitraum reicht in die letzten Tage: das Archiv kann noch nachliefern. */
const TTL_RECENT_MS = 6 * 60 * 60_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Prueft und ergaenzt den Zeitraum; wirft mit lesbarem Grund. */
export function resolveRange(query: SolarRadiationHistoryQuery, now: number = Date.now()): { startDate: string; endDate: string } {
    const endDate = query.endDate ?? iso(now - ARCHIVE_DELAY_DAYS * DAY_MS);
    if (!ISO_DATE.test(endDate) || isNaN(Date.parse(endDate)))
        throw new Error(`SolarRadiationHistoryRetriever: invalid endDate ${endDate}`);
    const startDate = query.startDate ?? iso(Date.parse(endDate) - 6 * DAY_MS);
    if (!ISO_DATE.test(startDate) || isNaN(Date.parse(startDate)))
        throw new Error(`SolarRadiationHistoryRetriever: invalid startDate ${startDate}`);
    const span = (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS + 1;
    if (span < 1) throw new Error('SolarRadiationHistoryRetriever: startDate after endDate');
    if (span > MAX_SPAN_DAYS)
        throw new Error(`SolarRadiationHistoryRetriever: span ${span} days exceeds ${MAX_SPAN_DAYS} — split into yearly calls`);
    if (startDate < '1940-01-01') throw new Error('SolarRadiationHistoryRetriever: archive starts 1940-01-01');
    if (endDate > iso(now)) throw new Error('SolarRadiationHistoryRetriever: endDate in the future — use SolarRadiationRetriever');
    return { startDate, endDate };
}

/** Haltezeit: alles laenger als die Archiv-Verzoegerung zurueck → 30 Tage, sonst 6 h. */
export function historyTtl(endDate: string, now: number = Date.now()): number {
    return Date.parse(endDate) < now - (ARCHIVE_DELAY_DAYS + 1) * DAY_MS ? TTL_SETTLED_MS : TTL_RECENT_MS;
}

export async function getSolarHistory(lat: number, lng: number, startDate: string, endDate: string): Promise<SolarRadiationResult> {
    const url = openMeteoUrl(OPEN_METEO_ARCHIVE_URL, lat, lng, { hourly: solarVariables(true), start_date: startDate, end_date: endDate });
    const data = await fetchOpenMeteo(url, 'solar archive');
    return toResult(data, toHours(data, true), 'archive');
}

export class SolarRadiationHistoryRetriever extends Dog<SolarRadiationResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return SolarRadiationHistoryRetriever.name;
    }
    get description(): string {
        return 'Hourly historical solar irradiance (GHI, DNI, DHI, direct horizontal; W/m², horizontal plane) plus cloud cover, temperature and wind for a past period (1940 up to ~6 days ago, max 366 days per call), with daily kWh/m² sums. For yield calculations. Open-Meteo archive, cached up to 30 days per 1 km cell.';
    }
    get icon(): string | undefined {
        return '📈';
    }
    get required(): DogClass[] {
        return [SolarRadiationHistoryQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<SolarRadiationResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(SolarRadiationHistoryQueryPact, d));
        const query = (queryDog?.collected as SolarRadiationHistoryQuery | undefined) ?? ({} as SolarRadiationHistoryQuery);
        const { lat, lng } = parseLatLng(query, this.name);
        const { startDate, endDate } = resolveRange(query);

        const fetchIt = () => getSolarHistory(lat, lng, startDate, endDate);
        if (!this.cacheHandler) return fetchIt();
        const key = openMeteoCacheKey('solar-archive', lat, lng, { start: startDate, end: endDate });
        return this.cacheHandler.getOrFetch(key, historyTtl(endDate), fetchIt);
    };
}

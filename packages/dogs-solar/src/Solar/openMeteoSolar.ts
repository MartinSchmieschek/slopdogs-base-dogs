/**
 * =========================================================================
 *  OPEN-METEO SOLAR — was nur die Solar-Dogs brauchen
 * =========================================================================
 *
 *  Abruf, Cache-Schluessel und Ort kommen aus slopdogs-openmeteo. Hier bleiben
 *  die Strahlungsfelder und die Tagessummen in kWh/m².
 */

import { OPEN_METEO_SOURCE, hourlyRows, hourlyVariables, toLocation, type OpenMeteoResponse } from '@martinschmieschek/slopdogs-openmeteo';
import type { SolarDay, SolarHour, SolarRadiationResult } from './interfaces/solarTypes';

/** Strahlung — alle drei Schnittstellen kennen sie unter diesen Namen. */
const RADIATION_FIELDS = {
    ghi: 'shortwave_radiation',
    directHorizontal: 'direct_radiation',
    dhi: 'diffuse_radiation',
    dni: 'direct_normal_irradiance',
};
/** Wetter, das fuer Ertragsrechnungen zaehlt (Modultemperatur). Satellit kennt es nicht. */
const WEATHER_FIELDS = { cloudCover: 'cloud_cover', temperature: 'temperature_2m', windSpeed: 'wind_speed_10m' };

/** `hourly=`-Liste: nur Strahlung oder Strahlung plus Wetter. */
export function solarVariables(withWeather: boolean): string {
    return hourlyVariables(withWeather ? { ...RADIATION_FIELDS, ...WEATHER_FIELDS } : RADIATION_FIELDS);
}

/** Open-Meteo-Stundenspalten → Stunden. */
export function toHours(data: OpenMeteoResponse, withWeather: boolean): SolarHour[] {
    return withWeather ? hourlyRows(data, { ...RADIATION_FIELDS, ...WEATHER_FIELDS }) : hourlyRows(data, RADIATION_FIELDS);
}

const kWh = (wh: number): number => Math.round(wh) / 1000;

/** Tagessummen: Stundenmittel in W/m² × 1 h = Wh/m². Stunden ohne GHI zaehlen nicht mit. */
export function dailyTotals(hours: SolarHour[]): SolarDay[] {
    const byDate = new Map<string, { ghi: number; direct: number; diffuse: number; n: number }>();
    for (const h of hours) {
        if (h.ghi === null) continue;
        const date = h.time.slice(0, 10);
        const d = byDate.get(date) ?? { ghi: 0, direct: 0, diffuse: 0, n: 0 };
        d.ghi += h.ghi;
        d.direct += h.directHorizontal ?? 0;
        d.diffuse += h.dhi ?? 0;
        d.n++;
        byDate.set(date, d);
    }
    return [...byDate.entries()].map(([date, d]) => ({
        date,
        ghiKWhPerM2: kWh(d.ghi),
        directKWhPerM2: kWh(d.direct),
        diffuseKWhPerM2: kWh(d.diffuse),
        hoursWithData: d.n,
    }));
}

/** Baut das gemeinsame Ergebnis aus einer Open-Meteo-Antwort. */
export function toResult(data: OpenMeteoResponse, hours: SolarHour[], kind: SolarRadiationResult['kind']): SolarRadiationResult {
    return { location: toLocation(data), hours, days: dailyTotals(hours), kind, source: OPEN_METEO_SOURCE };
}

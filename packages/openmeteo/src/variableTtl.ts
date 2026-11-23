/**
 * =========================================================================
 *  OPEN-METEO VARIABLE TTL — wie lange ein Wert gilt, haengt an der Variable
 * =========================================================================
 *
 *  Wenige Klassen statt einer Zahl je Dog. Ein Dog darf nur strenger sein:
 *  sein maxAge gilt als min(TTL der Variable, maxAge des Dogs).
 */

import { OPEN_METEO_AIR_QUALITY_URL, OPEN_METEO_FORECAST_URL } from './api';
import type { CellSectionName } from './cellStore';

const MINUTE = 60_000;

/** Haltezeit je Klasse. */
export const OPEN_METEO_TTL_CLASSES = {
    /** current der Vorhersage: Open-Meteo erneuert die aktuellen Werte etwa alle 15 min. */
    current: 15 * MINUTE,
    /** current der Luftqualitaet: CAMS rechnet stuendlich. */
    currentHourly: 60 * MINUTE,
    /** Schnell wechselnde Stundenwerte (Niederschlag, Konvektion, Wolken, Strahlung, Wind, Temperatur, Feuchte) — auch alles Unbekannte. */
    fast: 30 * MINUTE,
    /** Traege Stundenwerte: tiefere Bodenschichten, Schneedecke, Frost- und Schneefallgrenze, Verdunstung. */
    slow: 60 * MINUTE,
    /**
     * Astronomische Tageswerte: Auf-, Untergang, Tageslaenge haengen nur an Datum und Ort, an keinem Modelllauf.
     * Ein Tageswechsel ueber die gespeicherte Achse hinaus ersetzt den Abschnitt trotzdem wie sonst auch.
     */
    astronomy: 24 * 60 * MINUTE,
} as const;

export type OpenMeteoTtlClass = keyof typeof OPEN_METEO_TTL_CLASSES;

/** Klasse von current je API; nicht genannte APIs wie die Vorhersage. */
export const OPEN_METEO_CURRENT_CLASS_BY_API: Readonly<Record<string, OpenMeteoTtlClass>> = {
    [OPEN_METEO_FORECAST_URL]: 'current',
    [OPEN_METEO_AIR_QUALITY_URL]: 'currentHourly',
};

const SLOW_HOURLY = new Set([
    'soil_temperature_6cm',
    'soil_temperature_18cm',
    'soil_temperature_54cm',
    'soil_moisture_1_to_3cm',
    'soil_moisture_3_to_9cm',
    'soil_moisture_9_to_27cm',
    'soil_moisture_27_to_81cm',
    'snow_depth',
    'freezing_level_height',
    'snowfall_height',
    'et0_fao_evapotranspiration',
    'evapotranspiration',
]);

const ASTRONOMY_DAILY = new Set(['sunrise', 'sunset', 'daylight_duration']);

/** Klasse einer Variable in ihrem Abschnitt und ihrer API. Tageswerte des Modells (Sonnenstunden, UV-Maximum) sind Wetter: fast. */
export function openMeteoTtlClass(section: CellSectionName, variable: string, api: string = OPEN_METEO_FORECAST_URL): OpenMeteoTtlClass {
    if (section === 'current') return OPEN_METEO_CURRENT_CLASS_BY_API[api] ?? 'current';
    if (section === 'daily' && ASTRONOMY_DAILY.has(variable)) return 'astronomy';
    return section === 'hourly' && SLOW_HOURLY.has(variable) ? 'slow' : 'fast';
}

/** Haltezeit einer Variable in ihrem Abschnitt und ihrer API. */
export function openMeteoVariableTtlMs(section: CellSectionName, variable: string, api: string = OPEN_METEO_FORECAST_URL): number {
    return OPEN_METEO_TTL_CLASSES[openMeteoTtlClass(section, variable, api)];
}

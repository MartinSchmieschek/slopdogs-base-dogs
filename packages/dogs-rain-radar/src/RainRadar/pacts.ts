/**
 * =========================================================================
 *  RAIN RADAR PACTS
 * =========================================================================
 */

import { createPact } from '@martinschmieschek/slopdogs-core';

/** Regenradar-Abfrage */
export interface RainRadarQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Radius des Rasters in km, ganzzahlig 0-10 (default: 2 = 5×5 Zellen; (2r+1)² Zellen zu 1 km) */
    radiusKm?: string;
    /** Vorhersage-Horizont in Minuten ab dem Radarlauf, 0-120 in 5er-Schritten (default: 120) */
    horizonMin?: string;
}

export const RainRadarQueryPact = createPact<RainRadarQuery>('RainRadarQueryProvider', { fromSourceType: 'RainRadarQuery' });

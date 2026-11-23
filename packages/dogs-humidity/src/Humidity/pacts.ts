/**
 * =========================================================================
 *  HUMIDITY PACTS
 * =========================================================================
 */

import { createPact } from '@martinschmieschek/slopdogs-core';

/** Feuchte-Abfrage */
export interface HumidityQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Vorhersage-Tage ab heute (default: 7, max: 7) */
    days?: string;
}

export const HumidityQueryPact = createPact<HumidityQuery>('HumidityQueryProvider', { fromSourceType: 'HumidityQuery' });

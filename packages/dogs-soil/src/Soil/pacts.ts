/**
 * =========================================================================
 *  SOIL PACTS
 * =========================================================================
 */

import { createPact } from '@martinschmieschek/slopdogs-core';

/** Boden-Abfrage */
export interface SoilQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Vorhersage-Tage ab heute (default: 3, max: 7) */
    days?: string;
}

/** Wasserhaushalt-Abfrage */
export interface EvapotranspirationQuery {
    /** Breitengrad */
    lat: string;
    /** Laengengrad */
    lng: string;
    /** Vorhersage-Tage ab heute (default: 7, max: 7) */
    days?: string;
}

export const SoilQueryPact = createPact<SoilQuery>('SoilQueryProvider', { fromSourceType: 'SoilQuery' });

export const EvapotranspirationQueryPact = createPact<EvapotranspirationQuery>('EvapotranspirationQueryProvider', {
    fromSourceType: 'EvapotranspirationQuery',
});

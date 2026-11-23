/**
 * =========================================================================
 *  DOGS-SOLAR — Sonneneinstrahlung: Vorhersage, Archiv, Satellit
 * =========================================================================
 *
 *  Paketintern bleibt openMeteoSolar (Strahlungsfelder, Tagessummen); Abruf und Cache: slopdogs-openmeteo.
 */

export * from './Solar/SolarRadiationRetriever';
export * from './Solar/SolarRadiationHistoryRetriever';
export * from './Solar/SatelliteRadiationRetriever';
export * from './Solar/pacts';
export * from './Solar/interfaces/solarTypes';

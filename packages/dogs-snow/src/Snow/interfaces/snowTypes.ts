/**
 * =========================================================================
 *  SNOW TYPES — Schnee und Frostgrenzen
 * =========================================================================
 */

/** Eine Stunde Schnee */
export interface SnowHour {
    /** Zeitstempel (ISO, Ortszeit des Standorts) */
    time: string;
    /** Schneehoehe am Boden, m */
    snowDepth: number | null;
    /** Neuschnee der vorangehenden Stunde, cm */
    snowfall: number | null;
    /** Hoehe, ab der Niederschlag als Schnee faellt, m ueber NN */
    snowfallHeight: number | null;
    /** Nullgradgrenze, m ueber NN */
    freezingLevel: number | null;
    /** Lufttemperatur 2 m, °C */
    temperature: number | null;
    /** Niederschlag (Regen + Schnee als Wasser), mm */
    precipitation: number | null;
}

/** Tageswerte */
export interface SnowDay {
    /** Datum (YYYY-MM-DD, Ortszeit) */
    date: string;
    /** Neuschnee-Summe, cm */
    snowfallSum: number | null;
    /** Hoechste Schneehoehe, m */
    snowDepthMax: number | null;
    /** Tiefste Schneefallgrenze, m ueber NN */
    snowfallHeightMin: number | null;
    /** Tiefste Nullgradgrenze, m ueber NN */
    freezingLevelMin: number | null;
}

export interface SnowResult {
    location: { lat: number; lng: number; elevation: number | null; timezone: string; utcOffsetSeconds: number };
    hours: SnowHour[];
    days: SnowDay[];
    units: Record<string, string>;
    source: string;
    /** Nur gesetzt (true), wenn das Open-Meteo-Budget erschoepft ist und aeltere Daten aus dem Zellen-Speicher kommen */
    stale?: boolean;
}

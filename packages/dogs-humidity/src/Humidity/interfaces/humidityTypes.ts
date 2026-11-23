/**
 * =========================================================================
 *  HUMIDITY TYPES — Luftfeuchte und Taupunkt
 * =========================================================================
 */

/** Eine Stunde Luftfeuchte */
export interface HumidityHour {
    /** Zeitstempel (ISO, Ortszeit des Standorts) */
    time: string;
    /** Lufttemperatur 2 m, °C */
    temperature: number | null;
    /** Relative Luftfeuchte 2 m, % */
    relativeHumidity: number | null;
    /** Taupunkt 2 m, °C */
    dewPoint: number | null;
    /** Feuchtkugeltemperatur 2 m, °C */
    wetBulbTemperature: number | null;
    /** Dampfdruckdefizit, kPa */
    vapourPressureDeficit: number | null;
}

/** Tageswerte */
export interface HumidityDay {
    /** Datum (YYYY-MM-DD, Ortszeit) */
    date: string;
    /** Mittlere relative Feuchte, % */
    relativeHumidityMean: number | null;
    /** Hoechste relative Feuchte, % */
    relativeHumidityMax: number | null;
    /** Mittlerer Taupunkt, °C */
    dewPointMean: number | null;
    /** Tiefste Feuchtkugeltemperatur, °C */
    wetBulbTemperatureMin: number | null;
    /** Mittlere Lufttemperatur, °C */
    temperatureMean: number | null;
}

export interface HumidityResult {
    location: { lat: number; lng: number; elevation: number | null; timezone: string; utcOffsetSeconds: number };
    hours: HumidityHour[];
    days: HumidityDay[];
    units: Record<string, string>;
    source: string;
    /** Nur gesetzt (true), wenn das Open-Meteo-Budget erschoepft ist und aeltere Daten aus dem Zellen-Speicher kommen */
    stale?: boolean;
}

/**
 * =========================================================================
 *  RAIN RADAR TYPES — DWD-Niederschlagsradar als Raster um einen Punkt
 * =========================================================================
 */

/** Wie viel des Rasters im Radargitter (DE1200) liegt. Ausserhalb sind die Werte null. */
export type RainRadarCoverage = 'full' | 'partial' | 'none';

/** Ein 5-Minuten-Schritt */
export interface RainRadarStep {
    /** Ende des 5-Minuten-Intervalls (ISO, UTC) */
    time: string;
    /** false fuer die Analyse des Laufs (gemessen), true fuer die Vorhersage danach */
    forecast: boolean;
}

/** Niederschlag der Mittelzelle in einem Schritt */
export interface RainRadarPointValue {
    /** Ende des 5-Minuten-Intervalls (ISO, UTC) */
    time: string;
    /** Niederschlagsrate, mm/h (null: ausserhalb des Gitters oder Schritt fehlt) */
    mmPerHour: number | null;
}

/**
 * Das Raster: `rows[step][row][col]` in mm/h, `step` wie `steps`, je `size` Zeilen zu `size` Zellen.
 * Zeile 0 liegt im Norden, Spalte 0 im Westen; die Mittelzelle ist `rows[step][radiusKm][radiusKm]`.
 * Die Zellen folgen dem Radargitter (polarstereografisch, ausgerichtet auf 10° O) — Norden ist bis auf
 * wenige Grad oben.
 */
export interface RainRadarGrid {
    radiusKm: number;
    /** Kantenlaenge einer Zelle, km */
    cellKm: 1;
    /** Zellen je Seite: 2 × radiusKm + 1 */
    size: number;
    rows: Array<Array<Array<number | null>>>;
}

export interface RainRadarResult {
    /** Gefragter Punkt und seine Zelle im Radargitter (Spalte gridX von West, Zeile gridY von Nord; null weit ausserhalb) */
    location: { lat: number; lng: number; gridX: number | null; gridY: number | null };
    coverage: RainRadarCoverage;
    /** Zeit des Radarlaufs (ISO, UTC) = Zeit der Analyse; null ohne Abdeckung */
    run: string | null;
    steps: RainRadarStep[];
    grid: RainRadarGrid;
    /** Reihe der Mittelzelle, ein Wert je Schritt */
    point: RainRadarPointValue[];
    units: { precipitation: 'mm/h'; time: string };
    source: string;
    attribution: string;
    /** Nur gesetzt (true), wenn Bright Sky nicht erreichbar oder der Abruf-Waechter voll war und ein frueherer Lauf geliefert wird */
    stale?: boolean;
}

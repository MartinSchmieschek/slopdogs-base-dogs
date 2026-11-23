/**
 * =========================================================================
 *  RADAR PICTURE — Raster, Schritte und Punktreihe aus den Kacheln einer Anfrage
 * =========================================================================
 *
 *  Der Lauf des Ergebnisses ist der neueste der Kacheln; die Schritte reichen von seiner Analyse
 *  bis `horizonMin` danach. Stammt eine Kachel aus einem aelteren Lauf (stale oder frueher im Slot
 *  geholt), fehlen ihr die letzten Schritte — dort steht null.
 */

import type { RainRadarCoverage, RainRadarResult, RainRadarStep } from './interfaces/rainRadarTypes';
import { isoUtc } from './brightSky';
import { rawToMmPerHour, type RadarTileFrames } from './radarFrames';
import type { GridPixel, RadarWindow } from './radarGrid';
import type { RainRadarParams } from './rainRadarQuery';
import { RADAR_STEP_MS } from './radarTileStore';

export const RAIN_RADAR_SOURCE = 'DWD RV radar composite via Bright Sky (brightsky.dev)';
export const RAIN_RADAR_ATTRIBUTION = 'Deutscher Wetterdienst (CC BY 4.0), via Bright Sky';

type Cell = number | null;

export class RadarPicture {
    private readonly steps: RainRadarStep[];

    constructor(
        private readonly params: RainRadarParams,
        private readonly centre: GridPixel | null,
        private readonly window: RadarWindow | null,
        private readonly tiles: RadarTileFrames[],
    ) {
        this.steps = this.run === null ? [] : this.stepsFrom(Date.parse(this.run));
    }

    /** Neuester Lauf der Kacheln (ISO, UTC); null ohne Kachel. */
    get run(): string | null {
        return this.tiles.reduce<string | null>((newest, t) => (newest === null || t.run > newest ? t.run : newest), null);
    }

    get coverage(): RainRadarCoverage {
        return this.window?.coverage ?? 'none';
    }

    get stale(): boolean {
        return this.tiles.some((t) => t.stale);
    }

    toResult(): RainRadarResult {
        const rows = this.steps.map((step) => this.rowsAt(step.time));
        const middle = this.params.radiusKm;
        const result: RainRadarResult = {
            location: { lat: this.params.lat, lng: this.params.lng, gridX: this.centre?.x ?? null, gridY: this.centre?.y ?? null },
            coverage: this.coverage,
            run: this.run,
            steps: this.steps,
            grid: { radiusKm: this.params.radiusKm, cellKm: 1, size: 2 * middle + 1, rows },
            point: this.steps.map((step, i) => ({ time: step.time, mmPerHour: rows[i][middle]?.[middle] ?? null })),
            units: { precipitation: 'mm/h', time: 'UTC, end of the 5-minute interval' },
            source: RAIN_RADAR_SOURCE,
            attribution: RAIN_RADAR_ATTRIBUTION,
        };
        return this.stale ? { ...result, stale: true } : result;
    }

    private stepsFrom(run: number): RainRadarStep[] {
        const count = this.params.horizonMin / (RADAR_STEP_MS / 60_000) + 1;
        return Array.from({ length: count }, (_, i) => ({ time: isoUtc(run + i * RADAR_STEP_MS), forecast: i > 0 }));
    }

    private rowsAt(time: string): Cell[][] {
        const size = 2 * this.params.radiusKm + 1;
        return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => this.valueAt(time, row, col)));
    }

    private valueAt(time: string, row: number, col: number): Cell {
        const pixel = this.window?.pixelAt(row, col);
        if (!pixel) return null;
        const raw = this.tiles.find((t) => t.contains(pixel))?.rawAt(time, pixel) ?? null;
        return raw === null ? null : rawToMmPerHour(raw);
    }
}

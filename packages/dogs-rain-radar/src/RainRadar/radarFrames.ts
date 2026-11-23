/**
 * =========================================================================
 *  RADAR FRAMES — eine Kachel eines Radarlaufs, wie sie im Cache liegt
 * =========================================================================
 *
 *  Bright Sky liefert je Zeitpunkt `precipitation_5` als base64 von zlib-gepackten
 *  2-Byte-Ganzzahlen, Zeile fuer Zeile (Nord zuerst), Einheit 0,01 mm je 5 min. Im Cache
 *  bleiben die Frames gepackt (wenige hundert Byte je Frame); entpackt wird beim Lesen.
 *  Bright Sky setzt Pixel ohne Messung auf 0 (brightsky/parsers.py, RadarParser) — kein
 *  Datenloch ist von „trocken“ zu unterscheiden.
 */

import { inflateSync } from 'node:zlib';
import type { GridPixel } from './radarGrid';

/** 0,01 mm je 5 min → mm/h: × 12 / 100 (Rohwert 25 = 3 mm/h). */
export function rawToMmPerHour(raw: number): number {
    return (raw * 12) / 100;
}

/** Entpackt einen `compressed`-Frame zu Rohwerten; prueft die Laenge gegen die Kachel. */
export function decodeRadarFrame(data: string, pixels: number): Uint16Array {
    const bytes = inflateSync(Buffer.from(data, 'base64'));
    if (bytes.length !== pixels * 2) {
        throw new Error(`Bright Sky radar: frame has ${bytes.length / 2} pixels, expected ${pixels}`);
    }
    const aligned = new Uint8Array(bytes);
    return new Uint16Array(aligned.buffer, 0, pixels);
}

/** Ein Frame: Ende des 5-min-Intervalls (ISO, UTC) und die gepackten Werte. */
export interface StoredRadarFrame {
    time: string;
    data: string;
}

/** Eine Kachel eines Laufs: Lage im Gitter, Laufzeit und die Frames ab der Analyse. */
export interface StoredRadarTile {
    /** Radarlauf (ISO, UTC), aus `source` = RADARCOMP::RV::<Lauf> */
    run: string;
    top: number;
    left: number;
    width: number;
    height: number;
    frames: StoredRadarFrame[];
}

/** Liest Werte aus einer gespeicherten Kachel; jeder Frame wird hoechstens einmal entpackt. */
export class RadarTileFrames {
    private readonly decoded = new Map<string, Uint16Array>();
    private readonly byTime: Map<string, string>;

    constructor(
        private readonly stored: StoredRadarTile,
        readonly stale = false,
    ) {
        this.byTime = new Map(stored.frames.map((f) => [f.time, f.data]));
    }

    get run(): string {
        return this.stored.run;
    }

    contains({ x, y }: GridPixel): boolean {
        const { left, top, width, height } = this.stored;
        return x >= left && x < left + width && y >= top && y < top + height;
    }

    /** Rohwert (0,01 mm / 5 min) der Zelle zum Zeitpunkt; null, wenn die Kachel diesen Frame nicht hat. */
    rawAt(time: string, { x, y }: GridPixel): number | null {
        const values = this.frame(time);
        return values ? values[(y - this.stored.top) * this.stored.width + (x - this.stored.left)] : null;
    }

    private frame(time: string): Uint16Array | undefined {
        const cached = this.decoded.get(time);
        if (cached) return cached;
        const data = this.byTime.get(time);
        if (data === undefined) return undefined;
        const values = decodeRadarFrame(data, this.stored.width * this.stored.height);
        this.decoded.set(time, values);
        return values;
    }
}

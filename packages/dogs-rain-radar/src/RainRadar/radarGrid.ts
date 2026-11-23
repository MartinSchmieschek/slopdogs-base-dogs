/**
 * =========================================================================
 *  RADAR GRID — DE1200-Gitter, Projektion, feste Kacheln, Fenster um einen Punkt
 * =========================================================================
 *
 *  Das RV-Komposit des DWD liegt auf dem DE1200-Gitter: 1100 Spalten (West→Ost) × 1200 Zeilen
 *  (Nord→Sued), je 1 km. Projektion laut Bright Sky (openapi.json, /radar):
 *  `+proj=stere +lat_0=90 +lat_ts=60 +lon_0=10 +a=6378137 +b=6356752.3142451802
 *   +x_0=543196.83521776402 +y_0=3622588.8619310018`; Pixel 0 reicht in x von -500 bis 500,
 *  in y von 500 bis -500. Nachgerechnet: die vier dokumentierten Ecken landen auf < 1 mm genau auf
 *  den Gitterecken, und Bright Skys `latlon_position` fuer Paderborn trifft dieselbe Zelle.
 *
 *  Kacheln: 32 × 32 Pixel. Das groesste Fenster (Radius 10 km = 21 Pixel) ueberspannt damit hoechstens
 *  zwei Kacheln je Achse, also hoechstens vier; 32 ist die kleinste Zweierpotenz >= 21. Kleinere Kacheln
 *  braeuchten bis zu neun Abrufe je Anfrage, groessere laden je Abruf mehr Flaeche, als ein Fenster braucht.
 */

export const GRID_COLUMNS = 1100;
export const GRID_ROWS = 1200;
export const TILE_PIXELS = 32;

const SEMI_MAJOR = 6378137;
const SEMI_MINOR = 6356752.3142451802;
const ECCENTRICITY = Math.sqrt(1 - (SEMI_MINOR * SEMI_MINOR) / (SEMI_MAJOR * SEMI_MAJOR));
const TRUE_SCALE_LAT = (60 * Math.PI) / 180;
const CENTRAL_LON = (10 * Math.PI) / 180;
const FALSE_EASTING = 543196.83521776402;
const FALSE_NORTHING = 3622588.8619310018;
const PIXEL_M = 1000;

/** Snyder (15-9): t fuer die polarstereografische Projektion auf dem Ellipsoid. */
function isometricT(lat: number): number {
    const esin = ECCENTRICITY * Math.sin(lat);
    return Math.tan(Math.PI / 4 - lat / 2) / Math.pow((1 - esin) / (1 + esin), ECCENTRICITY / 2);
}

/** Snyder (14-15): m am Breitengrad. */
function parallelRadius(lat: number): number {
    return Math.cos(lat) / Math.sqrt(1 - (ECCENTRICITY * Math.sin(lat)) ** 2);
}

const TRUE_SCALE_FACTOR = (SEMI_MAJOR * parallelRadius(TRUE_SCALE_LAT)) / isometricT(TRUE_SCALE_LAT);

/** Projizierte Meter (x nach Osten, y nach Norden) im Radargitter. */
export function projectToRadar(lat: number, lng: number): { x: number; y: number } {
    const phi = (lat * Math.PI) / 180;
    const dLambda = (lng * Math.PI) / 180 - CENTRAL_LON;
    const rho = TRUE_SCALE_FACTOR * isometricT(phi);
    return { x: FALSE_EASTING + rho * Math.sin(dLambda), y: FALSE_NORTHING - rho * Math.cos(dLambda) };
}

/** Eine Zelle des Gitters: Spalte x von West, Zeile y von Nord. Darf ausserhalb des Gitters liegen. */
export interface GridPixel {
    x: number;
    y: number;
}

/** Die Zelle, in der der Punkt liegt; null, wenn die Projektion dort nichts Endliches liefert (Suedpol). */
export function gridPixelOf(lat: number, lng: number): GridPixel | null {
    const { x, y } = projectToRadar(lat, lng);
    const pixel = { x: Math.floor((x + PIXEL_M / 2) / PIXEL_M), y: Math.floor((PIXEL_M / 2 - y) / PIXEL_M) };
    return Number.isFinite(pixel.x) && Number.isFinite(pixel.y) ? pixel : null;
}

export function isInGrid({ x, y }: GridPixel): boolean {
    return x >= 0 && x < GRID_COLUMNS && y >= 0 && y < GRID_ROWS;
}

/** Eine feste Kachel des Gitters; am Ost- und Suedrand schmaler. */
export class RadarTile {
    constructor(
        readonly column: number,
        readonly row: number,
    ) {}

    static containing({ x, y }: GridPixel): RadarTile {
        return new RadarTile(Math.floor(x / TILE_PIXELS), Math.floor(y / TILE_PIXELS));
    }

    get key(): string {
        return `${this.column}_${this.row}`;
    }
    get left(): number {
        return this.column * TILE_PIXELS;
    }
    get top(): number {
        return this.row * TILE_PIXELS;
    }
    get right(): number {
        return Math.min(this.left + TILE_PIXELS, GRID_COLUMNS) - 1;
    }
    get bottom(): number {
        return Math.min(this.top + TILE_PIXELS, GRID_ROWS) - 1;
    }
    get width(): number {
        return this.right - this.left + 1;
    }
    get height(): number {
        return this.bottom - this.top + 1;
    }
    /** Bright Skys `bbox`: oben, links, unten, rechts in Pixeln, Raender eingeschlossen. */
    get bbox(): string {
        return [this.top, this.left, this.bottom, this.right].join(',');
    }

    contains({ x, y }: GridPixel): boolean {
        return x >= this.left && x <= this.right && y >= this.top && y <= this.bottom;
    }
}

/** Das quadratische Fenster aus (2r+1)² Zellen um eine Mittelzelle. */
export class RadarWindow {
    constructor(
        readonly centre: GridPixel,
        readonly radius: number,
    ) {}

    get size(): number {
        return 2 * this.radius + 1;
    }

    /** Zelle in Zeile `row`, Spalte `col` des Fensters (0 = Nordwest); null ausserhalb des Gitters. */
    pixelAt(row: number, col: number): GridPixel | null {
        const pixel = { x: this.centre.x - this.radius + col, y: this.centre.y - this.radius + row };
        return isInGrid(pixel) ? pixel : null;
    }

    /** Die Kacheln, die den Teil des Fensters im Gitter abdecken: 0 bis 4. */
    tiles(): RadarTile[] {
        const bounds = this.gridBounds();
        if (!bounds) return [];
        const tiles: RadarTile[] = [];
        for (let row = Math.floor(bounds.top / TILE_PIXELS); row <= Math.floor(bounds.bottom / TILE_PIXELS); row++) {
            for (let col = Math.floor(bounds.left / TILE_PIXELS); col <= Math.floor(bounds.right / TILE_PIXELS); col++) {
                tiles.push(new RadarTile(col, row));
            }
        }
        return tiles;
    }

    get coverage(): 'full' | 'partial' | 'none' {
        const bounds = this.gridBounds();
        if (!bounds) return 'none';
        const inside = (bounds.right - bounds.left + 1) * (bounds.bottom - bounds.top + 1);
        return inside === this.size * this.size ? 'full' : 'partial';
    }

    private gridBounds(): { left: number; top: number; right: number; bottom: number } | null {
        const left = Math.max(this.centre.x - this.radius, 0);
        const right = Math.min(this.centre.x + this.radius, GRID_COLUMNS - 1);
        const top = Math.max(this.centre.y - this.radius, 0);
        const bottom = Math.min(this.centre.y + this.radius, GRID_ROWS - 1);
        return left <= right && top <= bottom ? { left, top, right, bottom } : null;
    }
}

/**
 * =========================================================================
 *  RAIN RADAR RETRIEVER — DWD-Niederschlagsradar um einen GPS-Punkt
 * =========================================================================
 */

import { Dog, IHuntingSeason, type ICacheHandler, type ICacheable, type IHuntingDog } from '@martinschmieschek/slopdogs-core';
import type { RainRadarResult } from './interfaces/rainRadarTypes';
import { RainRadarQueryPact, type RainRadarQuery } from './pacts';
import { RadarPicture } from './radarPicture';
import { RadarWindow, gridPixelOf } from './radarGrid';
import { loadRadarTile } from './radarTileStore';
import { parseRainRadarQuery, type RainRadarParams } from './rainRadarQuery';

/** Wie `required`/`optional` in core: Konstruktoren mit beliebigen Argumenten. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DogClass = new (...args: any[]) => IHuntingDog<unknown>;

/** Radar-Raster und Punktreihe fuer geprueften Parameter; `now` nur fuer Tests. */
export async function getRainRadar(params: RainRadarParams, cache?: ICacheHandler, now = Date.now()): Promise<RainRadarResult> {
    const centre = gridPixelOf(params.lat, params.lng);
    const window = centre && new RadarWindow(centre, params.radiusKm);
    const tiles = window ? await Promise.all(window.tiles().map((tile) => loadRadarTile(tile, cache, now))) : [];
    return new RadarPicture(params, centre, window, tiles).toResult();
}

export class RainRadarRetriever extends Dog<RainRadarResult> implements ICacheable {
    private cacheHandler?: ICacheHandler;

    setCacheHandler(handler: ICacheHandler): void {
        this.cacheHandler = handler;
    }
    get name(): string {
        return RainRadarRetriever.name;
    }
    get description(): string {
        return (
            'Precipitation radar of the German Weather Service (DWD RV composite, via Bright Sky) as a small grid of 1 km cells ' +
            'around GPS coordinates: the latest radar analysis plus the nowcast in 5-minute steps up to +120 min, in mm/h, ' +
            'with the series for the centre cell. radiusKm 0-10 (default 2 = 5x5 km), horizonMin 0-120 (default 120). ' +
            'Raw data only, no "rain starts in X min" summary. Shared tile cache: one Bright Sky fetch per 32 km tile and ' +
            'radar run for all users; the newest run is 7-12 min old when served. Limits: the forecast only moves existing ' +
            'rain along (advection), new showers are not foreseen; coverage is Germany and its borders (cells off the grid ' +
            'are null, inside the grid missing radar data reads as 0); radar does not see dry clouds. ' +
            'Attribution: Deutscher Wetterdienst (CC BY 4.0), via Bright Sky.'
        );
    }
    get icon(): string | undefined {
        return '🌧️';
    }
    get required(): DogClass[] {
        return [RainRadarQueryPact];
    }
    get optional(): DogClass[] {
        return [];
    }

    protected yieldCollectorFactory = async (season: IHuntingSeason): Promise<RainRadarResult> => {
        const queryDog = season.exhausted.find((d) => this.matchesParent(RainRadarQueryPact, d));
        const query = (queryDog?.collected as RainRadarQuery | undefined) ?? {};
        return getRainRadar(parseRainRadarQuery(query), this.cacheHandler);
    };
}

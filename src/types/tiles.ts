import { Feature } from 'geojson';

/**
 * Interface for tile information used throughout the application
 */
export interface ITile {
  x: number;
  y: number;
  z: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  data?: string;
  loading?: boolean;
  error?: boolean;
}

/**
 * Interface for feature tile information
 */
export interface IFeatureTile {
  x: number;
  y: number;
  z: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Type definition for tile data functions - all tile data functions should conform to this signature
 */
export type TileDataFunction = (tile: ITile) => Promise<ImageBitmap | null>;

/**
 * Wrapper for feature tile data that includes byteLength for Deck.gl compatibility
 */
export interface FeatureTileData {
  features: Feature[];
  byteLength: number;
}

/**
 * Type definition for feature tile data functions
 */
export type FeatureTileDataFunction = (tile: IFeatureTile) => Promise<FeatureTileData>;

/**
 * Configuration options for tile loading
 */
export interface TileLoadConfig {
  tileSize?: number;
  timeout?: number;
  maxRetries?: number;
  enableDebugLogging?: boolean;
}

/**
 * Tile cache configuration
 */
export interface TileCacheConfig {
  maxCacheSize?: number;
  maxCacheByteSize?: number;
  enableCache?: boolean;
}

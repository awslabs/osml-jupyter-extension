import { Feature, FeatureCollection } from 'geojson';

/**
 * Heatmap point data structure
 */
export interface HeatmapPoint {
  position: [number, number];
  weight: number;
}

/**
 * Feature layer configuration
 */
export interface FeatureLayerConfig {
  id: string;
  heatmapZoomThreshold?: number;
  heatmapRadiusPixels?: number;
  heatmapIntensity?: number;
  featureFillColor?: [number, number, number, number];
  featureLineColor?: [number, number, number, number];
  featureLineWidth?: number;
  enableDebugLogging?: boolean;
}

/**
 * Multi-resolution feature layer properties
 */
export interface MultiResolutionFeatureLayerConfig extends FeatureLayerConfig {
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  maxCacheSize?: number;
  maxCacheByteSize?: number;
}

/**
 * Feature processing options
 */
export interface FeatureProcessingOptions {
  extractCentroid?: boolean;
  calculateBounds?: boolean;
  validateGeometry?: boolean;
}

/**
 * Feature cache entry
 */
export interface FeatureCacheEntry {
  features: Feature[];
  byteLength: number;
  timestamp: number;
  tileKey: string;
}

// Copyright Amazon.com, Inc. or its affiliates.

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

// Copyright Amazon.com, Inc. or its affiliates.

import { Feature } from 'geojson';

/**
 * Heatmap point data structure
 */
export interface IHeatmapPoint {
  position: [number, number];
  weight: number;
}

/**
 * Feature layer configuration
 */
export interface IFeatureLayerConfig {
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
export interface IFeatureProcessingOptions {
  extractCentroid?: boolean;
  calculateBounds?: boolean;
  validateGeometry?: boolean;
}

/**
 * Feature cache entry
 */
export interface IFeatureCacheEntry {
  features: Feature[];
  byteLength: number;
  timestamp: number;
  tileKey: string;
}

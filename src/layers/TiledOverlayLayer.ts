// Copyright Amazon.com, Inc. or its affiliates.

import {
  Layer,
  LayersList,
  GetPickingInfoParams,
  PickingInfo,
  DefaultProps
} from '@deck.gl/core';
import { GeoJsonLayer } from '@deck.gl/layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Feature, Geometry, Point } from 'geojson';

import { TileLayer } from '@deck.gl/geo-layers';
import type { TileLayerProps, TileLayerPickingInfo } from '@deck.gl/geo-layers';

// Define our own types since internal types aren't exported
interface ITile2DHeader<T = any> {
  id: string;
  x: number;
  y: number;
  z: number;
  bbox: any;
  content?: T;
  isLoaded?: boolean;
  layers?: any[];
}

import {
  FeatureTileDataFunction,
  IFeatureTile,
  IFeatureTileData
} from '../types';

/**
 * Color type definition
 */
type Color = [number, number, number] | [number, number, number, number];

/**
 * Properties for TiledOverlayLayer
 */
export interface ITiledOverlayLayerProps
  extends Omit<TileLayerProps<IFeatureTileData>, 'data' | 'getTileData'> {
  /** Function to load feature data for tiles */
  getTileData: FeatureTileDataFunction;

  // Culling options
  /** Maximum number of features to render per tile (default: 1000) */
  maxFeaturesPerTile?: number;

  /** Minimum area in pixels for polygon visibility (default: 1.0) */
  minFeatureAreaPixels?: number;

  /** Minimum size in pixels for point visibility (default: 0.5) */
  minFeatureSizePixels?: number;

  // LOD options
  /** Geometry simplification tolerance in pixels (default: 0.5) */
  simplificationTolerance?: number;

  /** Distance in pixels for point clustering (default: 20) */
  clusterDistance?: number;

  /** Zoom levels where LOD transitions occur (default: [-3, 0, 3]) */
  lodZoomThresholds?: number[];

  // Rendering options
  /** Feature fill color */
  featureFillColor?: Color;

  /** Feature line color */
  featureLineColor?: Color;

  /** Feature line width */
  featureLineWidth?: number;

  /** Whether to scale point size with zoom (default: true) */
  adaptivePointSize?: boolean;

  /** Enable debug logging */
  enableDebugLogging?: boolean;
}

const defaultProps: DefaultProps<ITiledOverlayLayerProps> = {
  maxFeaturesPerTile: 1000,
  minFeatureAreaPixels: 1.0,
  minFeatureSizePixels: 0.5,
  simplificationTolerance: 0.5,
  clusterDistance: 20,
  lodZoomThresholds: [-3, 0, 3],
  featureFillColor: [255, 0, 0, 128],
  featureLineColor: [255, 0, 0, 255],
  featureLineWidth: 1,
  adaptivePointSize: true,
  enableDebugLogging: false,
  tileSize: 512,
  minZoom: -10,
  maxZoom: 10,
  maxCacheSize: 100,
  maxCacheByteSize: 50 * 1024 * 1024, // 50MB
  debounceTime: 100
};

export type TiledOverlayLayerPickingInfo<
  FeaturePropertiesT = Record<string, never>
> = TileLayerPickingInfo<
  IFeatureTileData,
  PickingInfo<Feature<Geometry, FeaturePropertiesT>>
>;

/**
 * Point cluster for LOD optimization
 */
interface IPointCluster {
  position: [number, number];
  count: number;
  features: Feature<Point>[];
}

// Type alias to match usage in the code
type Tile2DHeader = ITile2DHeader;
type FeatureTileData = IFeatureTileData;
type PointCluster = IPointCluster;

/**
 * A tile-based overlay layer optimized for rendering large numbers of features
 * with automatic culling and level-of-detail optimizations.
 */
export class TiledOverlayLayer extends TileLayer<IFeatureTileData> {
  static layerName = 'TiledOverlayLayer';
  static defaultProps = defaultProps;

  /**
   * Get typed props helper
   */
  private get typedProps(): ITiledOverlayLayerProps {
    return this.props as any;
  }

  /**
   * Debug logging utility
   */
  private debugLog(message: string, data?: any): void {
    if (this.typedProps.enableDebugLogging) {
      console.log(`[TiledOverlayLayer] ${message}`, data || '');
    }
  }

  /**
   * Get the current zoom level from the viewport
   */
  private getCurrentZoom(): number {
    return this.context.viewport?.zoom || 0;
  }

  /**
   * Calculate the pixel scale at current zoom level
   */
  private getPixelScale(): number {
    const zoom = this.getCurrentZoom();
    return Math.pow(2, -zoom);
  }

  /**
   * Override getTileData to convert to our tile format
   */
  getTileData(tileProps: any): Promise<FeatureTileData> | FeatureTileData {
    const getTileDataFn = this.typedProps.getTileData;
    if (!getTileDataFn) {
      return { features: [], byteLength: 0 };
    }

    const { index } = tileProps;
    const { x, y, z } = index;

    // Convert TileLayer's tile format to our IFeatureTile format
    const scale = Math.pow(2, -z);
    const tileSize = this.props.tileSize || 512;
    const tile: IFeatureTile = {
      x,
      y,
      z,
      left: x * tileSize * scale,
      top: y * tileSize * scale,
      right: (x + 1) * tileSize * scale,
      bottom: (y + 1) * tileSize * scale
    };

    this.debugLog(`Loading tile data for ${x}-${y}-${z}`, tile);
    return getTileDataFn(tile);
  }

  /**
   * Apply spatial culling to remove features outside tile bounds
   */
  private applySpatialCulling(
    features: Feature[],
    tile: Tile2DHeader
  ): Feature[] {
    const { bbox } = tile;

    // Handle different bbox formats
    let bounds: { left: number; top: number; right: number; bottom: number };

    if (
      'left' in bbox &&
      'top' in bbox &&
      'right' in bbox &&
      'bottom' in bbox
    ) {
      // Pixel coordinate format
      bounds = {
        left: bbox.left,
        top: bbox.top,
        right: bbox.right,
        bottom: bbox.bottom
      };
    } else if (
      'west' in bbox &&
      'north' in bbox &&
      'east' in bbox &&
      'south' in bbox
    ) {
      // Geographic coordinate format - convert to our pixel format naming
      bounds = {
        left: (bbox as any).west,
        top: (bbox as any).north,
        right: (bbox as any).east,
        bottom: (bbox as any).south
      };
    } else {
      // Fallback: try to extract from array format [[minX, minY], [maxX, maxY]]
      const bboxArray = bbox as any;
      if (Array.isArray(bboxArray) && bboxArray.length === 2) {
        bounds = {
          left: bboxArray[0][0],
          top: bboxArray[0][1],
          right: bboxArray[1][0],
          bottom: bboxArray[1][1]
        };
      } else {
        // Cannot determine bounds, skip spatial culling for this tile
        return features;
      }
    }

    return features.filter(feature => {
      const geometry = feature.geometry || feature.properties?.imageGeometry;
      if (!geometry) {
        return false;
      }

      return this.isGeometryInBounds(geometry, bounds);
    });
  }

  /**
   * Check if geometry intersects with tile bounds
   */
  private isGeometryInBounds(
    geometry: Geometry,
    bounds: { left: number; top: number; right: number; bottom: number }
  ): boolean {
    switch (geometry.type) {
      case 'Point': {
        const [x, y] = geometry.coordinates;
        return (
          x >= bounds.left &&
          x <= bounds.right &&
          y >= bounds.top &&
          y <= bounds.bottom
        );
      }

      case 'LineString':
        return geometry.coordinates.some(coord => {
          const [x, y] = coord;
          return (
            x >= bounds.left &&
            x <= bounds.right &&
            y >= bounds.top &&
            y <= bounds.bottom
          );
        });

      case 'Polygon': {
        // Check if any point of outer ring is in bounds
        const outerRing = geometry.coordinates[0];
        return outerRing.some(coord => {
          const [x, y] = coord;
          return (
            x >= bounds.left &&
            x <= bounds.right &&
            y >= bounds.top &&
            y <= bounds.bottom
          );
        });
      }

      case 'MultiPoint':
        return geometry.coordinates.some(coord => {
          const [x, y] = coord;
          return (
            x >= bounds.left &&
            x <= bounds.right &&
            y >= bounds.top &&
            y <= bounds.bottom
          );
        });

      case 'MultiLineString':
        return geometry.coordinates.some(lineString =>
          lineString.some(coord => {
            const [x, y] = coord;
            return (
              x >= bounds.left &&
              x <= bounds.right &&
              y >= bounds.top &&
              y <= bounds.bottom
            );
          })
        );

      case 'MultiPolygon':
        return geometry.coordinates.some(polygon =>
          polygon[0].some(coord => {
            const [x, y] = coord;
            return (
              x >= bounds.left &&
              x <= bounds.right &&
              y >= bounds.top &&
              y <= bounds.bottom
            );
          })
        );

      default:
        return false;
    }
  }

  /**
   * Apply zoom-based culling to remove features too small to be visible
   */
  private applyZoomBasedCulling(features: Feature[]): Feature[] {
    const pixelScale = this.getPixelScale();
    const { minFeatureAreaPixels, minFeatureSizePixels } = this.typedProps;

    return features.filter(feature => {
      const geometry = feature.geometry || feature.properties?.imageGeometry;
      if (!geometry) {
        return false;
      }

      switch (geometry.type) {
        case 'Point':
        case 'MultiPoint':
          // Points are always visible if they pass spatial culling
          return true;

        case 'LineString':
        case 'MultiLineString': {
          const length = this.calculateGeometryLength(geometry);
          return length * pixelScale >= minFeatureSizePixels!;
        }

        case 'Polygon':
        case 'MultiPolygon': {
          const area = this.calculateGeometryArea(geometry);
          return area * pixelScale * pixelScale >= minFeatureAreaPixels!;
        }

        default:
          return true;
      }
    });
  }

  /**
   * Calculate the area of a geometry in pixel coordinates
   */
  private calculateGeometryArea(geometry: Geometry): number {
    switch (geometry.type) {
      case 'Polygon':
        return this.calculatePolygonArea(geometry.coordinates[0]);

      case 'MultiPolygon':
        return geometry.coordinates.reduce(
          (total, polygon) => total + this.calculatePolygonArea(polygon[0]),
          0
        );

      default:
        return 0;
    }
  }

  /**
   * Calculate the length of a geometry in pixel coordinates
   */
  private calculateGeometryLength(geometry: Geometry): number {
    switch (geometry.type) {
      case 'LineString':
        return this.calculateLineStringLength(geometry.coordinates);

      case 'MultiLineString':
        return geometry.coordinates.reduce(
          (total, lineString) =>
            total + this.calculateLineStringLength(lineString),
          0
        );

      default:
        return 0;
    }
  }

  /**
   * Calculate polygon area using shoelace formula
   */
  private calculatePolygonArea(coordinates: number[][]): number {
    if (coordinates.length < 3) {
      return 0;
    }

    let area = 0;
    const numPoints = coordinates.length - 1; // Exclude closing point

    for (let i = 0; i < numPoints; i++) {
      const j = (i + 1) % numPoints;
      area += coordinates[i][0] * coordinates[j][1];
      area -= coordinates[j][0] * coordinates[i][1];
    }

    return Math.abs(area) / 2;
  }

  /**
   * Calculate line string length
   */
  private calculateLineStringLength(coordinates: number[][]): number {
    if (coordinates.length < 2) {
      return 0;
    }

    let length = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      const dx = coordinates[i + 1][0] - coordinates[i][0];
      const dy = coordinates[i + 1][1] - coordinates[i][1];
      length += Math.sqrt(dx * dx + dy * dy);
    }

    return length;
  }

  /**
   * Apply count-based culling to limit features per tile
   */
  private applyCountBasedCulling(features: Feature[]): Feature[] {
    const { maxFeaturesPerTile } = this.typedProps;

    if (features.length <= maxFeaturesPerTile!) {
      return features;
    }

    // Sort by area/length (larger features first) then take top N
    const featuresWithSize = features.map(feature => ({
      feature,
      size: this.getFeatureImportanceScore(feature)
    }));

    featuresWithSize.sort((a, b) => b.size - a.size);

    this.debugLog(
      `Count-based culling: ${features.length} -> ${maxFeaturesPerTile} features`
    );

    return featuresWithSize
      .slice(0, maxFeaturesPerTile!)
      .map(item => item.feature);
  }

  /**
   * Calculate feature importance score for culling decisions
   */
  private getFeatureImportanceScore(feature: Feature): number {
    const geometry = feature.geometry || feature.properties?.imageGeometry;
    if (!geometry) {
      return 0;
    }

    switch (geometry.type) {
      case 'Polygon':
      case 'MultiPolygon':
        return this.calculateGeometryArea(geometry);

      case 'LineString':
      case 'MultiLineString':
        return this.calculateGeometryLength(geometry);

      case 'Point':
      case 'MultiPoint':
        // Points get constant score, but can be weighted by properties
        return feature.properties?.weight || 1;

      default:
        return 1;
    }
  }

  /**
   * Simplify polygon geometry by reducing vertex count
   */
  private simplifyPolygon(
    coordinates: number[][],
    tolerance: number
  ): number[][] {
    if (coordinates.length <= 3) {
      return coordinates;
    }

    // Douglas-Peucker algorithm simplified version
    const simplified: number[][] = [coordinates[0]]; // Always keep first point

    for (let i = 1; i < coordinates.length - 1; i++) {
      const prev = simplified[simplified.length - 1];
      const curr = coordinates[i];
      const next = coordinates[i + 1];

      // Calculate perpendicular distance from current point to line prev->next
      const distance = this.perpendicularDistance(curr, prev, next);

      if (distance >= tolerance) {
        simplified.push(curr);
      }
    }

    // Always keep last point (which should equal first for closed polygons)
    simplified.push(coordinates[coordinates.length - 1]);

    return simplified;
  }

  /**
   * Calculate perpendicular distance from point to line
   */
  private perpendicularDistance(
    point: number[],
    lineStart: number[],
    lineEnd: number[]
  ): number {
    const [x0, y0] = point;
    const [x1, y1] = lineStart;
    const [x2, y2] = lineEnd;

    const dx = x2 - x1;
    const dy = y2 - y1;

    if (dx === 0 && dy === 0) {
      // Line start and end are the same point
      const dx2 = x0 - x1;
      const dy2 = y0 - y1;
      return Math.sqrt(dx2 * dx2 + dy2 * dy2);
    }

    const t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy);
    const clampedT = Math.max(0, Math.min(1, t));

    const projX = x1 + clampedT * dx;
    const projY = y1 + clampedT * dy;

    const distX = x0 - projX;
    const distY = y0 - projY;

    return Math.sqrt(distX * distX + distY * distY);
  }

  /**
   * Apply geometry simplification based on zoom level
   */
  private applyGeometrySimplification(features: Feature[]): Feature[] {
    const pixelScale = this.getPixelScale();
    const { simplificationTolerance } = this.typedProps;
    const tolerance = simplificationTolerance! / pixelScale; // Convert to world units

    return features.map(feature => {
      const geometry = feature.geometry || feature.properties?.imageGeometry;
      if (!geometry || tolerance <= 0) {
        return feature;
      }

      const simplifiedGeometry = this.simplifyGeometry(geometry, tolerance);

      return {
        ...feature,
        geometry: simplifiedGeometry
      };
    });
  }

  /**
   * Simplify geometry based on type
   */
  private simplifyGeometry(geometry: Geometry, tolerance: number): Geometry {
    switch (geometry.type) {
      case 'Polygon':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(ring =>
            this.simplifyPolygon(ring, tolerance)
          )
        };

      case 'MultiPolygon':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(polygon =>
            polygon.map(ring => this.simplifyPolygon(ring, tolerance))
          )
        };

      case 'LineString':
        return {
          ...geometry,
          coordinates: this.simplifyPolygon(geometry.coordinates, tolerance)
        };

      case 'MultiLineString':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(lineString =>
            this.simplifyPolygon(lineString, tolerance)
          )
        };

      default:
        return geometry; // Points don't need simplification
    }
  }

  /**
   * Cluster nearby points for LOD optimization
   */
  private clusterPoints(features: Feature[]): Feature[] {
    const zoom = this.getCurrentZoom();
    const { clusterDistance, lodZoomThresholds } = this.typedProps;

    // Only cluster at low zoom levels
    if (zoom > lodZoomThresholds![1]) {
      return features;
    }

    const points: Feature<Point>[] = [];
    const nonPoints: Feature[] = [];

    // Separate points from other geometries
    features.forEach(feature => {
      const geometry = feature.geometry || feature.properties?.imageGeometry;
      if (geometry?.type === 'Point') {
        points.push(feature as Feature<Point>);
      } else {
        nonPoints.push(feature);
      }
    });

    if (points.length === 0) {
      return features;
    }

    // Cluster points
    const clusters = this.createPointClusters(points, clusterDistance!);
    const clusteredFeatures: Feature[] = [];

    clusters.forEach(cluster => {
      if (cluster.count === 1) {
        // Single point, keep as-is
        clusteredFeatures.push(cluster.features[0]);
      } else {
        // Create cluster feature
        const clusterFeature: Feature<Point> = {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: cluster.position
          },
          properties: {
            ...cluster.features[0].properties,
            cluster: true,
            point_count: cluster.count,
            point_count_abbreviated:
              cluster.count > 1000
                ? `${Math.round(cluster.count / 100) / 10}k`
                : cluster.count
          }
        };
        clusteredFeatures.push(clusterFeature);
      }
    });

    this.debugLog(
      `Point clustering: ${points.length} -> ${clusteredFeatures.length} points`
    );

    return [...nonPoints, ...clusteredFeatures];
  }

  /**
   * Create point clusters using simple distance-based clustering
   */
  private createPointClusters(
    points: Feature<Point>[],
    clusterDistance: number
  ): PointCluster[] {
    const pixelScale = this.getPixelScale();
    const distance = clusterDistance / pixelScale; // Convert to world units
    const clusters: PointCluster[] = [];
    const used = new Set<number>();

    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) {
        continue;
      }

      const point = points[i];
      const [x, y] = point.geometry.coordinates;

      const cluster: PointCluster = {
        position: [x, y],
        count: 1,
        features: [point]
      };

      used.add(i);

      // Find nearby points to add to cluster
      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) {
          continue;
        }

        const otherPoint = points[j];
        const [ox, oy] = otherPoint.geometry.coordinates;

        const dx = x - ox;
        const dy = y - oy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= distance) {
          cluster.features.push(otherPoint);
          cluster.count++;
          used.add(j);

          // Update cluster position to centroid
          const totalX = cluster.features.reduce(
            (sum, f) => sum + f.geometry.coordinates[0],
            0
          );
          const totalY = cluster.features.reduce(
            (sum, f) => sum + f.geometry.coordinates[1],
            0
          );
          cluster.position = [
            totalX / cluster.features.length,
            totalY / cluster.features.length
          ];
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Apply all LOD optimizations to features
   */
  private applyLODOptimizations(
    features: Feature[],
    tile: Tile2DHeader
  ): Feature[] {
    // 1. Apply geometry simplification
    let optimizedFeatures = this.applyGeometrySimplification(features);

    // 2. Apply point clustering
    optimizedFeatures = this.clusterPoints(optimizedFeatures);

    return optimizedFeatures;
  }

  /**
   * Process features for a tile with all optimizations
   */
  private processTileFeatures(
    tileData: FeatureTileData,
    tile: Tile2DHeader
  ): Feature[] {
    let features = [...tileData.features]; // Copy to avoid mutation

    this.debugLog(`Processing ${features.length} features for tile ${tile.id}`);

    // 1. Spatial culling
    features = this.applySpatialCulling(features, tile);
    this.debugLog(`After spatial culling: ${features.length} features`);

    // 2. Zoom-based culling
    features = this.applyZoomBasedCulling(features);
    this.debugLog(`After zoom-based culling: ${features.length} features`);

    // 3. LOD optimizations
    features = this.applyLODOptimizations(features, tile);
    this.debugLog(`After LOD optimizations: ${features.length} features`);

    // 4. Count-based culling (last, to ensure we don't exceed limits)
    //features = this.applyCountBasedCulling(features);
    //this.debugLog(`After count-based culling: ${features.length} features`);

    return features;
  }

  /**
   * Render sub-layers for each tile
   */
  renderSubLayers(props: any): Layer | null | LayersList {
    const { data: tileData, tile } = props;

    console.log(
      `[TiledOverlayLayer] renderSubLayers called for tile ${tile.x}-${tile.y}-${tile.z}`,
      {
        hasTileData: !!tileData,
        featureCount: tileData?.features?.length || 0,
        tileId: props.id
      }
    );

    if (!tileData || !tileData.features || tileData.features.length === 0) {
      console.log(
        `[TiledOverlayLayer] No features for tile ${tile.x}-${tile.y}-${tile.z}`
      );
      return null;
    }

    // Process features with culling and LOD optimizations
    const processedFeatures = this.processTileFeatures(tileData, tile);

    console.log(
      `[TiledOverlayLayer] Processed features for tile ${tile.x}-${tile.y}-${tile.z}:`,
      {
        originalCount: tileData.features.length,
        processedCount: processedFeatures.length
      }
    );

    if (processedFeatures.length === 0) {
      console.log(
        `[TiledOverlayLayer] No processed features for tile ${tile.x}-${tile.y}-${tile.z}`
      );
      return null;
    }

    // Separate different geometry types for optimal rendering
    const points: Feature[] = [];
    const lines: Feature[] = [];
    const polygons: Feature[] = [];

    processedFeatures.forEach(feature => {
      const geometry = feature.geometry || feature.properties?.imageGeometry;
      if (!geometry) {
        return;
      }

      switch (geometry.type) {
        case 'Point':
        case 'MultiPoint':
          points.push(feature);
          break;
        case 'LineString':
        case 'MultiLineString':
          lines.push(feature);
          break;
        case 'Polygon':
        case 'MultiPolygon':
          polygons.push(feature);
          break;
      }
    });

    console.log(
      `[TiledOverlayLayer] Feature type breakdown for tile ${tile.x}-${tile.y}-${tile.z}:`,
      {
        points: points.length,
        lines: lines.length,
        polygons: polygons.length
      }
    );

    const layers: Layer[] = [];
    const {
      featureFillColor,
      featureLineColor,
      featureLineWidth,
      adaptivePointSize
    } = this.typedProps;

    // Render polygons and lines with GeoJsonLayer
    if (polygons.length > 0 || lines.length > 0) {
      const geoJsonData = {
        type: 'FeatureCollection' as const,
        features: [...polygons, ...lines]
      };

      console.log(
        `[TiledOverlayLayer] Creating GeoJsonLayer with ${geoJsonData.features.length} features (tile ${tile.x}-${tile.y}-${tile.z})`
      );

      const geoJsonLayer = new GeoJsonLayer({
        ...props,
        id: `${props.id}-geojson`,
        data: geoJsonData,
        getFillColor: featureFillColor!,
        getLineColor: featureLineColor!,
        getLineWidth: featureLineWidth!,
        filled: true,
        stroked: true,
        lineWidthMinPixels: 1,
        pickable: true
      });

      console.log('[TiledOverlayLayer] GeoJsonLayer created:', {
        id: geoJsonLayer.id,
        pickable: geoJsonLayer.props.pickable,
        dataLength: geoJsonData.features.length
      });

      layers.push(geoJsonLayer);
    }

    // Render points with ScatterplotLayer for better performance
    if (points.length > 0) {
      const pointData = points.map(feature => {
        const geometry = feature.geometry || feature.properties?.imageGeometry;
        const isCluster = feature.properties?.cluster;
        const pointCount = feature.properties?.point_count || 1;

        let coordinates: number[];
        if (geometry?.type === 'Point') {
          coordinates = geometry.coordinates;
        } else if (geometry?.type === 'MultiPoint') {
          coordinates = geometry.coordinates[0]; // Use first point
        } else {
          coordinates = [0, 0]; // Fallback
        }

        return {
          position: coordinates,
          feature,
          isCluster,
          pointCount
        };
      });

      const zoom = this.getCurrentZoom();
      const baseRadius = adaptivePointSize ? Math.max(2, 8 - zoom * 0.5) : 5;

      console.log(
        `[TiledOverlayLayer] Creating ScatterplotLayer with ${pointData.length} points (tile ${tile.x}-${tile.y}-${tile.z})`
      );

      const scatterplotLayer = new ScatterplotLayer({
        ...props,
        id: `${props.id}-points`,
        data: pointData,
        getPosition: (d: any) => d.position,
        getRadius: (d: any) => {
          if (d.isCluster) {
            // Scale cluster size by point count
            return baseRadius + Math.sqrt(d.pointCount) * 2;
          }
          return baseRadius;
        },
        getFillColor: (d: any) => {
          if (d.isCluster) {
            // Different color for clusters
            return [255, 165, 0, 200]; // Orange
          }
          return featureFillColor!;
        },
        getLineColor: featureLineColor!,
        getLineWidth: 1,
        stroked: true,
        filled: true,
        radiusMinPixels: 2,
        radiusMaxPixels: 50,
        pickable: true
      });

      console.log('[TiledOverlayLayer] ScatterplotLayer created:', {
        id: scatterplotLayer.id,
        pickable: scatterplotLayer.props.pickable,
        dataLength: pointData.length,
        baseRadius
      });

      layers.push(scatterplotLayer);
    }

    console.log(
      `[TiledOverlayLayer] Returning ${layers.length} sub-layers for tile ${tile.x}-${tile.y}-${tile.z}`
    );
    return layers;
  }

  /**
   * Override getPickingInfo to handle tile-based picking
   */
  getPickingInfo(params: GetPickingInfoParams): TiledOverlayLayerPickingInfo {
    const info = super.getPickingInfo(params) as TiledOverlayLayerPickingInfo;

    // The tile information is already available in info.tile
    // No need to add redundant properties

    return info;
  }

  /**
   * Clear cache method to maintain compatibility with MultiResolutionFeatureLayer
   */
  public clearCache(): void {
    // TileLayer handles its own caching, so this is primarily for interface compatibility
    // We could potentially add custom cache clearing logic here if needed
    this.debugLog('Cache cleared (TileLayer manages its own cache)');
  }
}

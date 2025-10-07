import {
  CompositeLayer,
  CompositeLayerProps,
  Layer,
  LayersList,
  UpdateParameters,
  DefaultProps
} from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { GeoJsonLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { Feature } from 'geojson';

import { 
  FeatureTileDataFunction, 
  IFeatureTile, 
  FeatureTileData,
  HeatmapPoint
} from '../types';

/**
 * Properties for MultiResolutionFeatureLayer
 */
export interface MultiResolutionFeatureLayerProps extends CompositeLayerProps {
  /** Function to load feature data for tiles */
  getTileData: FeatureTileDataFunction;
  
  /** Tile size in pixels */
  tileSize?: number;
  
  /** Minimum zoom level */
  minZoom?: number;
  
  /** Maximum zoom level */
  maxZoom?: number;
  
  /** Minimum zoom level for model inference (performance optimization) */
  minModelZoom?: number;
  
  /** Maximum zoom level for model inference (performance optimization) */
  maxModelZoom?: number;
  
  /** Zoom level threshold below which to use heatmap (default: -3) */
  heatmapZoomThreshold?: number;
  
  /** Maximum number of tiles to cache */
  maxCacheSize?: number;
  
  /** Maximum cache size in bytes */
  maxCacheByteSize?: number;
  
  /** Heatmap radius in pixels */
  heatmapRadiusPixels?: number;
  
  /** Heatmap intensity multiplier */
  heatmapIntensity?: number;
  
  /** Feature fill color */
  featureFillColor?: [number, number, number, number];
  
  /** Feature line color */
  featureLineColor?: [number, number, number, number];
  
  /** Feature line width */
  featureLineWidth?: number;
  
  /** Enable debug logging */
  enableDebugLogging?: boolean;
  
  /** Debounce time for tile requests (ms) */
  tileRequestDebounceTime?: number;
}

const defaultProps: DefaultProps<MultiResolutionFeatureLayerProps> = {
  tileSize: 512,
  minZoom: -10,
  maxZoom: 10,
  minModelZoom: -1,
  maxModelZoom: 1,
  heatmapZoomThreshold: -3,
  maxCacheSize: 100,
  maxCacheByteSize: 50 * 1024 * 1024, // 50MB
  heatmapRadiusPixels: 50,
  heatmapIntensity: 10,
  featureFillColor: [255, 0, 0, 30], // Red with alpha
  featureLineColor: [255, 0, 0, 255], // Solid red
  featureLineWidth: 1,
  enableDebugLogging: false,
  tileRequestDebounceTime: 150  // Debounce tile requests by 150ms
};

/**
 * A composite layer that renders features at multiple resolutions:
 * - High zoom levels (>= threshold): Individual features as polygons/points/lines
 * - Low zoom levels (< threshold): Aggregated heatmap visualization
 */
export class MultiResolutionFeatureLayer extends CompositeLayer<MultiResolutionFeatureLayerProps> {
  static layerName = 'MultiResolutionFeatureLayer';
  static defaultProps = defaultProps;

  state!: {
    allFeatures: Feature[];
    featureCache: Map<string, FeatureTileData>;
  };

  initializeState(): void {
    this.state = {
      allFeatures: [],
      featureCache: new Map()
    };
  }

  updateState({ changeFlags }: UpdateParameters<this>): void {
    // Clear cache if data source changes
    if (changeFlags.dataChanged || changeFlags.propsChanged) {
      this.state.featureCache.clear();
      this.state.allFeatures = [];
    }
  }

  /**
   * Debug logging utility
   */
  private debugLog(message: string, data?: any): void {
    if (this.props.enableDebugLogging) {
      console.log(`[MultiResolutionFeatureLayer] ${message}`, data || '');
    }
  }

  /**
   * Get the current zoom level from the view state
   */
  private getCurrentZoom(): number {
    const viewState = this.context.viewport;
    return viewState?.zoom || 0;
  }

  /**
   * Create a tile layer for loading feature data with performance optimizations
   */
  private createFeatureTileLayer(): TileLayer {
    const {
      getTileData,
      tileSize,
      minZoom,
      maxZoom,
      minModelZoom,
      maxModelZoom,
      maxCacheSize,
      maxCacheByteSize,
      tileRequestDebounceTime
    } = this.props;

    return new TileLayer({
      id: `${this.props.id}-tiles`,
      data: [], // Required but not used
      tileSize: tileSize!,
      minZoom: minZoom!,
      maxZoom: maxZoom!,
      maxCacheSize: maxCacheSize!,
      maxCacheByteSize: maxCacheByteSize!,
      refinementStrategy: 'best-available',
      debounceTime: tileRequestDebounceTime!,
      
      getTileData: async (tileProps: any) => {
        const x = tileProps.x ?? tileProps.index?.x;
        const y = tileProps.y ?? tileProps.index?.y;
        const z = tileProps.z ?? tileProps.index?.z;
        
        // Performance optimization: Skip model inference outside zoom range
        if (z < minModelZoom! || z > maxModelZoom!) {
          const tileKey = `${x}-${y}-${z}`;
          this.debugLog(`Skipping model inference for tile ${tileKey} at zoom ${z} (outside range ${minModelZoom}-${maxModelZoom})`);
          return { features: [], byteLength: 0 };
        }
        
        // Always log tile requests for debugging
        console.log(`[MultiResolutionFeatureLayer] getTileData called for tile ${x}-${y}-${z}`, tileProps);
        
        // Convert TileLayer's tile format to our IFeatureTile format
        const scale = Math.pow(2, -z);
        const tileSize = this.props.tileSize!;
        const tile: IFeatureTile = { 
          x, 
          y, 
          z, 
          left: x * tileSize * scale, 
          top: y * tileSize * scale, 
          right: (x + 1) * tileSize * scale, 
          bottom: (y + 1) * tileSize * scale 
        };
        
        const tileKey = `${x}-${y}-${z}`;
        
        // Check cache first
        if (this.state.featureCache.has(tileKey)) {
          const cachedTileData = this.state.featureCache.get(tileKey)!;
          this.debugLog(`Using cached features for tile ${tileKey}`, { count: cachedTileData.features.length });
          return cachedTileData;
        }
        
        this.debugLog(`Loading features for tile ${tileKey}`, tile);
        
        try {
          const tileData = await getTileData(tile);
          
          if (tileData.features.length > 0) {
            console.log(`[MultiResolutionFeatureLayer] Loaded ${tileData.features.length} features for tile ${tileKey}`);
          }
          
          // Cache the tile data
          this.state.featureCache.set(tileKey, tileData);
          
          // Add to all features collection (for heatmap)
          this.state.allFeatures.push(...tileData.features);
          
          // Force layer re-render when new features are loaded
          // We need to trigger a state change to force renderLayers() to be called again
          this.setState({
            featureCache: new Map(this.state.featureCache), // Create new Map to trigger change
            allFeatures: [...this.state.allFeatures] // Create new array to trigger change
          });
          
          this.debugLog(`Loaded ${tileData.features.length} features for tile ${tileKey}`);
          return tileData;
        } catch (error) {
          console.error(`[MultiResolutionFeatureLayer] Error loading features for tile ${tileKey}:`, error);
          return { features: [], byteLength: 0 };
        }
      },
      
      renderSubLayers: () => {
        // Return null - we handle rendering in the main renderLayers method
        return null;
      },
      
      onTileLoad: (tile: any) => {
        this.debugLog(`Feature tile loaded: ${tile.x}-${tile.y}-${tile.z}`);
      },
      
      onTileError: (error: any, tile?: any) => {
        const tileInfo = tile ? `${tile.x}-${tile.y}-${tile.z}` : 'unknown';
        console.error(`Feature tile error for ${tileInfo}:`, error);
      }
    });
  }

  /**
   * Create a GeoJSON layer for rendering individual features
   */
  private createFeatureLayer(): GeoJsonLayer {
    const {
      featureFillColor,
      featureLineColor,
      featureLineWidth
    } = this.props;

    // Collect all features from cache
    const allFeatures: Feature[] = [];
    for (const tileData of this.state.featureCache.values()) {
      allFeatures.push(...tileData.features);
    }

    this.debugLog(`[MultiResolutionFeatureLayer] Creating GeoJsonLayer with ${allFeatures.length} features`);
    if (allFeatures.length > 0) {
      console.log(`[MultiResolutionFeatureLayer] Sample feature:`, allFeatures[0]);
    }

    this.debugLog(`Rendering ${allFeatures.length} individual features`);

    return new GeoJsonLayer({
      id: `${this.props.id}-features`,
      data: {
        type: 'FeatureCollection',
        features: allFeatures
      },
      
      // Styling - make more visible for debugging
      getFillColor: [255, 0, 0, 128], // Bright red with 50% alpha
      getLineColor: [255, 0, 0, 255], // Solid red
      getLineWidth: 2, // Thicker line
      getPointRadius: 30, // Larger points
      
      // Properties
      filled: true,
      stroked: true,
      pickable: true,
      
      // Line properties
      lineWidthMinPixels: 2,
      
      // Point properties
      pointRadiusMinPixels: 10,
      pointRadiusMaxPixels: 100,
      
      // Force visibility
      visible: true,
      opacity: 1.0,
      
      updateTriggers: {
        data: [this.state.featureCache.size, this.getAllFeatures().length] // Trigger update when cache or feature count changes
      }
    });
  }

  /**
   * Create a heatmap layer for aggregated visualization
   */
  private createHeatmapLayer(): HeatmapLayer {
    const {
      heatmapRadiusPixels,
      heatmapIntensity
    } = this.props;

    // Collect all features and extract points for heatmap
    const allFeatures: Feature[] = [];
    for (const tileData of this.state.featureCache.values()) {
      allFeatures.push(...tileData.features);
    }

    // Extract heatmap points from features
    const heatmapPoints = this.extractHeatmapPoints(allFeatures);
    
    this.debugLog(`[MultiResolutionFeatureLayer] Creating heatmap with ${heatmapPoints.length} points from ${allFeatures.length} features`);
    this.debugLog(`[MultiResolutionFeatureLayer] Feature cache has ${this.state.featureCache.size} tiles`);
    if (heatmapPoints.length > 0) {
      console.log(`[MultiResolutionFeatureLayer] Sample heatmap point:`, heatmapPoints[0]);
    }
    
    this.debugLog(`Rendering heatmap with ${heatmapPoints.length} points`);

    return new HeatmapLayer({
      id: `${this.props.id}-heatmap`,
      data: heatmapPoints,
      
      getPosition: (d: any) => d.position,
      getWeight: (d: any) => d.weight,
      
      radiusPixels: heatmapRadiusPixels!,
      intensity: heatmapIntensity!,
      threshold: 0.05,
      
      // Make heatmap more visible for debugging
      colorRange: [
        [255, 255, 178, 25],
        [254, 204, 92, 102], 
        [253, 141, 60, 178],
        [240, 59, 32, 204],
        [189, 0, 38, 255]
      ],
      
      updateTriggers: {
        data: [this.state.featureCache.size, allFeatures.length] // Trigger update when cache or feature count changes
      }
    });
  }

  /**
   * Calculate the area of a polygon using the shoelace formula
   */
  private calculatePolygonArea(coordinates: number[][]): number {
    if (coordinates.length < 3) {
      return 0;
    }
    
    let area = 0;
    const numPoints = coordinates.length - 1; // Exclude the closing point
    
    for (let i = 0; i < numPoints; i++) {
      const j = (i + 1) % numPoints;
      area += coordinates[i][0] * coordinates[j][1];
      area -= coordinates[j][0] * coordinates[i][1];
    }
    
    return Math.abs(area) / 2;
  }

  /**
   * Calculate the length of a line string
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
   * Calculate weight based on geometry size
   */
  private calculateGeometryWeight(geometry: any): number {
    const tileSize = this.props.tileSize || 512;
    const pixelsPerTile = tileSize * tileSize; // 512 * 512 = 262,144
    
    switch (geometry.type) {
      case 'Point':
        // Points have no dimensions, always weight = 1
        return 1;
        
      case 'Polygon':
        // Weight = (area of polygon / pixels in tile) * 255
        const coords = geometry.coordinates[0]; // outer ring
        if (coords.length > 0) {
          const area = this.calculatePolygonArea(coords);
          const weight = (area / pixelsPerTile) * 255;
          return Math.min(255, Math.max(1, Math.round(weight))); // Clamp between 1-255
        }
        return 1;
        
      case 'LineString':
        // Weight = (length of line / tile side length) * 255
        const lineCoords = geometry.coordinates;
        if (lineCoords.length > 0) {
          const length = this.calculateLineStringLength(lineCoords);
          const weight = (length / tileSize) * 255;
          return Math.min(255, Math.max(1, Math.round(weight))); // Clamp between 1-255
        }
        return 1;
        
      default:
        return 1;
    }
  }

  /**
   * Extract point positions from features for heatmap rendering
   */
  private extractHeatmapPoints(features: Feature[]): HeatmapPoint[] {
    const points: HeatmapPoint[] = [];
    
    features.forEach(feature => {
      const geometry = feature.geometry || feature.properties?.imageGeometry;
      
      if (!geometry) {
        return;
      }
      
      // Calculate weight based on geometry size
      const weight = this.calculateGeometryWeight(geometry);
      
      switch (geometry.type) {
        case 'Point':
          points.push({
            position: [geometry.coordinates[0], geometry.coordinates[1]],
            weight: weight
          });
          break;
          
        case 'Polygon':
          // Use centroid of polygon
          const coords = geometry.coordinates[0]; // outer ring
          if (coords.length > 0) {
            const centroid = this.calculatePolygonCentroid(coords);
            points.push({
              position: centroid,
              weight: weight
            });
          }
          break;
          
        case 'LineString':
          // Use midpoint of line
          const lineCoords = geometry.coordinates;
          if (lineCoords.length > 0) {
            const midIndex = Math.floor(lineCoords.length / 2);
            points.push({
              position: [lineCoords[midIndex][0], lineCoords[midIndex][1]],
              weight: weight
            });
          }
          break;
      }
    });
    
    return points;
  }

  /**
   * Calculate the centroid of a polygon
   */
  private calculatePolygonCentroid(coordinates: number[][]): [number, number] {
    let x = 0;
    let y = 0;
    const numPoints = coordinates.length - 1; // Exclude the closing point
    
    for (let i = 0; i < numPoints; i++) {
      x += coordinates[i][0];
      y += coordinates[i][1];
    }
    
    return [x / numPoints, y / numPoints];
  }

  renderLayers(): LayersList {
    const currentZoom = this.getCurrentZoom();
    const { heatmapZoomThreshold } = this.props;
    
    // Always include the tile layer for data loading
    const tileLayer = this.createFeatureTileLayer();
    
    // Choose rendering layer based on zoom level
    const useHeatmap = currentZoom <= heatmapZoomThreshold!;
    
    this.debugLog(`Rendering at zoom ${currentZoom}, using ${useHeatmap ? 'heatmap' : 'features'}`);
    this.debugLog(`Feature cache size: ${this.state.featureCache.size}`);
    
    if (useHeatmap) {
      const heatmapLayer = this.createHeatmapLayer();
      this.debugLog(`Created heatmap layer with ${this.getAllFeatures().length} features`);
      return [tileLayer, heatmapLayer];
    } else {
      const featureLayer = this.createFeatureLayer();
      this.debugLog(`Created feature layer with ${this.getAllFeatures().length} features`);
      return [tileLayer, featureLayer];
    }
  }

  /**
   * Get the number of cached tiles
   */
  getCacheSize(): number {
    return this.state.featureCache.size;
  }

  /**
   * Clear the feature cache
   */
  clearCache(): void {
    this.state.featureCache.clear();
    this.state.allFeatures = [];
  }

  /**
   * Get all loaded features
   */
  getAllFeatures(): Feature[] {
    const allFeatures: Feature[] = [];
    for (const tileData of this.state.featureCache.values()) {
      allFeatures.push(...tileData.features);
    }
    return allFeatures;
  }
}

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
  extractHeatmapPoints 
} from './FeatureTileDataFunctions';

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
}

const defaultProps: DefaultProps<MultiResolutionFeatureLayerProps> = {
  tileSize: 512,
  minZoom: -10,
  maxZoom: 10,
  heatmapZoomThreshold: -3,
  maxCacheSize: 100,
  maxCacheByteSize: 50 * 1024 * 1024, // 50MB
  heatmapRadiusPixels: 25,
  heatmapIntensity: 1,
  featureFillColor: [255, 0, 0, 47], // Red with alpha
  featureLineColor: [255, 0, 0, 255], // Solid red
  featureLineWidth: 1,
  enableDebugLogging: false
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
   * Create a tile layer for loading feature data
   */
  private createFeatureTileLayer(): TileLayer {
    const {
      getTileData,
      tileSize,
      minZoom,
      maxZoom,
      maxCacheSize,
      maxCacheByteSize
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
      debounceTime: 100,
      
      getTileData: async (tileProps: any) => {
        const x = tileProps.x ?? tileProps.index?.x;
        const y = tileProps.y ?? tileProps.index?.y;
        const z = tileProps.z ?? tileProps.index?.z;
        
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
          console.log(`[MultiResolutionFeatureLayer] Using cached features for tile ${tileKey}`, { count: cachedTileData.features.length });
          this.debugLog(`Using cached features for tile ${tileKey}`, { count: cachedTileData.features.length });
          return cachedTileData;
        }
        
        console.log(`[MultiResolutionFeatureLayer] Loading features for tile ${tileKey}`, tile);
        this.debugLog(`Loading features for tile ${tileKey}`, tile);
        
        try {
          const tileData = await getTileData(tile);
          
          console.log(`[MultiResolutionFeatureLayer] Loaded ${tileData.features.length} features for tile ${tileKey}`);
          
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

    console.log(`[MultiResolutionFeatureLayer] Creating GeoJsonLayer with ${allFeatures.length} features`);
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

    const heatmapPoints = extractHeatmapPoints(allFeatures);
    
    console.log(`[MultiResolutionFeatureLayer] Creating heatmap with ${heatmapPoints.length} points from ${allFeatures.length} features`);
    console.log(`[MultiResolutionFeatureLayer] Feature cache has ${this.state.featureCache.size} tiles`);
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

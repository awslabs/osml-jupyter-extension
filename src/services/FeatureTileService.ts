import { Feature } from 'geojson';
import { IFeatureTile, FeatureTileData, FeatureTileDataFunction, FeatureCacheEntry } from '../types';
import { CommService } from './CommService';

/**
 * Service for managing feature tile data loading and processing
 */
export class FeatureTileService {
  private featureCache: Map<string, FeatureCacheEntry> = new Map();
  private enableDebugLogging: boolean = true;

  constructor(private commService: CommService) {}

  /**
   * Create a mock feature data function for testing
   */
  public createMockFeatureDataFunction(squareSize: number = 0.1): FeatureTileDataFunction {
    return async (tile: IFeatureTile): Promise<FeatureTileData> => {
      return this.createMockFeatureData(tile, squareSize);
    };
  }

  /**
   * Create a real feature data function that uses the comm service
   */
  public createRealFeatureDataFunction(
    imageName: string,
    overlayName: string
  ): FeatureTileDataFunction {
    return async (tile: IFeatureTile): Promise<FeatureTileData> => {
      return this.loadRealFeatureData(tile, imageName, overlayName);
    };
  }

  /**
   * Create a model feature data function that uses MODEL_TILE_REQUEST messages
   */
  public createModelFeatureDataFunction(
    dataset: string,
    endpointName: string
  ): FeatureTileDataFunction {
    return async (tile: IFeatureTile): Promise<FeatureTileData> => {
      return this.loadModelFeatureData(tile, dataset, endpointName);
    };
  }

  /**
   * Generate mock feature data for testing/debugging
   */
  private async createMockFeatureData(tile: IFeatureTile, squareSize: number): Promise<FeatureTileData> {
    const tileKey = `mock-${tile.x}-${tile.y}-${tile.z}`;
    
    // Check cache first
    if (this.featureCache.has(tileKey)) {
      const cached = this.featureCache.get(tileKey)!;
      this.debugLog(`Using cached mock features for tile ${tileKey}`, { count: cached.features.length });
      return { features: cached.features, byteLength: cached.byteLength };
    }

    return new Promise((resolve) => {
      const features: Feature[] = [];
      
      const tileWidth = tile.right - tile.left;
      const tileHeight = tile.bottom - tile.top;
      const centerX = tile.left + tileWidth / 2;
      const centerY = tile.top + tileHeight / 2;
      
      // Large square at center (20% of tile size)
      const centerSquareSize = Math.min(tileWidth, tileHeight) * 0.2;
      const centerSquare = this.createSquareFeature(
        centerX, 
        centerY, 
        centerSquareSize,
        `center-${tile.x}-${tile.y}-${tile.z}`,
        { weight: 10, type: 'center' }
      );
      features.push(centerSquare);
      
      // Smaller squares at corners
      const cornerSquareSize = Math.min(tileWidth, tileHeight) * squareSize;
      const cornerOffset = cornerSquareSize / 2;
      
      const corners = [
        { x: tile.left + cornerOffset, y: tile.top + cornerOffset, pos: 'top-left' },
        { x: tile.right - cornerOffset, y: tile.top + cornerOffset, pos: 'top-right' },
        { x: tile.left + cornerOffset, y: tile.bottom - cornerOffset, pos: 'bottom-left' },
        { x: tile.right - cornerOffset, y: tile.bottom - cornerOffset, pos: 'bottom-right' }
      ];

      corners.forEach(corner => {
        const cornerSquare = this.createSquareFeature(
          corner.x,
          corner.y,
          cornerSquareSize,
          `corner-${corner.pos}-${tile.x}-${tile.y}-${tile.z}`,
          { weight: 3, type: 'corner', position: corner.pos }
        );
        features.push(cornerSquare);
      });
      
      // Calculate approximate byte length for the features
      const byteLength = this.calculateFeaturesByteLength(features);
      
      // Cache the result
      const cacheEntry: FeatureCacheEntry = {
        features,
        byteLength,
        timestamp: Date.now(),
        tileKey
      };
      this.featureCache.set(tileKey, cacheEntry);
      
      this.debugLog(`Created mock features for tile ${tileKey}`, { count: features.length });
      
      resolve({ features, byteLength });
    });
  }

  /**
   * Load real feature data from the kernel via comm service
   */
  private async loadRealFeatureData(
    tile: IFeatureTile,
    imageName: string,
    overlayName: string
  ): Promise<FeatureTileData> {
    const tileKey = `${imageName}-${overlayName}-${tile.x}-${tile.y}-${tile.z}`;
    
    // Check cache first
    if (this.featureCache.has(tileKey)) {
      const cached = this.featureCache.get(tileKey)!;
      this.debugLog(`Using cached real features for tile ${tileKey}`, { count: cached.features.length });
      return { features: cached.features, byteLength: cached.byteLength };
    }

    if (!this.commService.isReady()) {
      console.error('CommService not ready for feature loading');
      return { features: [], byteLength: 0 };
    }

    try {
      this.debugLog(`Loading real features for tile ${tileKey}`);
      
      const response = await this.commService.sendMessage({
        type: 'OVERLAY_TILE_REQUEST',
        imageName: imageName,
        overlayName: overlayName,
        zoom: tile.z,
        row: tile.y,
        col: tile.x
      });

      const features = response.features || [];
      
      // Process features to ensure they have proper imageGeometry
      const processedFeatures = features.map((feature: Feature) => {
        if (feature.properties?.imageGeometry) {
          // Use imageGeometry as the main geometry for rendering
          return {
            ...feature,
            geometry: feature.properties.imageGeometry
          };
        }
        return feature;
      });
      
      // Calculate approximate byte length for the features
      const byteLength = this.calculateFeaturesByteLength(processedFeatures);
      
      // Cache the result
      const cacheEntry: FeatureCacheEntry = {
        features: processedFeatures,
        byteLength,
        timestamp: Date.now(),
        tileKey
      };
      this.featureCache.set(tileKey, cacheEntry);
      
      this.debugLog(`Loaded real features for tile ${tileKey}`, { count: processedFeatures.length });
      
      return { features: processedFeatures, byteLength };

    } catch (error) {
      console.error(`Error loading features for tile ${tileKey}:`, error);
      return { features: [], byteLength: 0 };
    }
  }

  /**
   * Load model feature data from the kernel via comm service using MODEL_TILE_REQUEST
   */
  private async loadModelFeatureData(
    tile: IFeatureTile,
    dataset: string,
    endpointName: string
  ): Promise<FeatureTileData> {
    const tileKey = `model-${dataset}-${endpointName}-${tile.x}-${tile.y}-${tile.z}`;
    
    // Check cache first
    if (this.featureCache.has(tileKey)) {
      const cached = this.featureCache.get(tileKey)!;
      this.debugLog(`Using cached model features for tile ${tileKey}`, { count: cached.features.length });
      return { features: cached.features, byteLength: cached.byteLength };
    }

    if (!this.commService.isReady()) {
      console.error('CommService not ready for model feature loading');
      return { features: [], byteLength: 0 };
    }

    try {
      this.debugLog(`Loading model features for tile ${tileKey}`);
      
      const response = await this.commService.sendMessage({
        type: 'MODEL_TILE_REQUEST',
        dataset: dataset,
        endpointName: endpointName,
        zoom: tile.z,
        row: tile.y,
        col: tile.x
      });

      const features = response.features || [];
      
      // Process features to ensure they have proper imageGeometry
      const processedFeatures = features.map((feature: Feature) => {
        if (feature.properties?.imageGeometry) {
          // Use imageGeometry as the main geometry for rendering
          return {
            ...feature,
            geometry: feature.properties.imageGeometry
          };
        }
        return feature;
      });
      
      // Calculate approximate byte length for the features
      const byteLength = this.calculateFeaturesByteLength(processedFeatures);
      
      // Cache the result
      const cacheEntry: FeatureCacheEntry = {
        features: processedFeatures,
        byteLength,
        timestamp: Date.now(),
        tileKey
      };
      this.featureCache.set(tileKey, cacheEntry);
      
      this.debugLog(`Loaded model features for tile ${tileKey}`, { count: processedFeatures.length });
      
      return { features: processedFeatures, byteLength };

    } catch (error) {
      console.error(`Error loading model features for tile ${tileKey}:`, error);
      return { features: [], byteLength: 0 };
    }
  }

  /**
   * Helper function to create a square feature
   */
  private createSquareFeature(
    centerX: number, 
    centerY: number, 
    size: number, 
    id: string,
    properties: any = {}
  ): Feature {
    const halfSize = size / 2;
    
    // Create square coordinates
    const coordinates = [[
      [centerX - halfSize, centerY - halfSize], // top-left
      [centerX + halfSize, centerY - halfSize], // top-right
      [centerX + halfSize, centerY + halfSize], // bottom-right
      [centerX - halfSize, centerY + halfSize], // bottom-left
      [centerX - halfSize, centerY - halfSize]  // close the polygon
    ]];
    
    const imageGeometry = {
      type: 'Polygon' as const,
      coordinates: coordinates
    };
    
    return {
      type: 'Feature',
      id: id,
      geometry: imageGeometry,
      properties: {
        ...properties,
        imageGeometry: imageGeometry,
        centerX: centerX,
        centerY: centerY,
        size: size
      }
    };
  }


  /**
   * Calculate approximate byte length for an array of features
   */
  private calculateFeaturesByteLength(features: Feature[]): number {
    if (!features || features.length === 0) {
      return 0;
    }
    
    try {
      const jsonString = JSON.stringify(features);
      return jsonString.length * 2 + (features.length * 100); // 100 bytes overhead per feature
    } catch (error) {
      // Fallback: estimate based on feature count
      return features.length * 1000; // 1KB per feature as rough estimate
    }
  }

  /**
   * Clear the feature cache
   */
  public clearCache(): void {
    this.featureCache.clear();
    this.debugLog('Feature cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; keys: string[]; totalFeatures: number } {
    let totalFeatures = 0;
    for (const entry of this.featureCache.values()) {
      totalFeatures += entry.features.length;
    }
    
    return {
      size: this.featureCache.size,
      keys: Array.from(this.featureCache.keys()),
      totalFeatures
    };
  }

  /**
   * Enable/disable debug logging
   */
  public setDebugLogging(enabled: boolean): void {
    this.enableDebugLogging = enabled;
  }

  /**
   * Debug logging utility
   */
  private debugLog(message: string, data?: any): void {
    if (this.enableDebugLogging) {
      console.log(`[FeatureTileService] ${message}`, data || '');
    }
  }

  /**
   * Dispose of the service and clean up resources
   */
  public dispose(): void {
    this.clearCache();
  }
}

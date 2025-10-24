// Copyright Amazon.com, Inc. or its affiliates.

import { Feature } from 'geojson';
import {
  IFeatureTile,
  IFeatureTileData,
  FeatureTileDataFunction,
  IFeatureCacheEntry
} from '../types';
import { CommService } from './CommService';
import { logger } from '../utils';

/**
 * Interface for overlay load response
 */
export interface IOverlayLoadResponse {
  success: boolean;
  status: string;
  error?: string;
}

/**
 * Callback function for when async tile data is loaded
 */
export type TileDataCallback = (tileId: string, data: IFeatureTileData) => void;

/**
 * Service for managing feature tile data loading and processing
 */
export class FeatureTileService {
  private featureCache: Map<string, IFeatureCacheEntry> = new Map();
  private loadingPromises: Map<string, Promise<IFeatureTileData>> = new Map();
  private dataChangeCallbacks: Map<string, Set<TileDataCallback>> = new Map();

  constructor(private commService: CommService) {}

  /**
   * Load an overlay and get its status
   */
  public async loadOverlay(
    imageName: string,
    overlayName: string
  ): Promise<IOverlayLoadResponse> {
    if (!this.commService.isReady()) {
      const errorMessage = 'Communication service not ready';
      logger.error(
        `FeatureTileService loadOverlay failed for ${overlayName}: ${errorMessage}`
      );
      return {
        success: false,
        status: 'COMM_NOT_READY',
        error: errorMessage
      };
    }

    try {
      const response = await this.commService.sendMessage({
        type: 'OVERLAY_LOAD_REQUEST',
        imageName: imageName,
        overlayName: overlayName
      });

      // Check if the overlay load was successful
      if (response.status !== 'SUCCESS') {
        const errorMessage = `Overlay could not be loaded (Status: ${response.status})`;
        logger.error(
          `FeatureTileService loadOverlay failed for ${overlayName}: ${response.status}`
        );
        return {
          success: false,
          status: response.status || 'UNKNOWN_ERROR',
          error: errorMessage
        };
      }

      return {
        success: true,
        status: response.status
      };
    } catch (error: any) {
      logger.error(
        `FeatureTileService loadOverlay failed for ${overlayName}: ${error.message}`
      );
      console.error(`Error loading overlay ${overlayName}:`, error);
      return {
        success: false,
        status: 'ERROR',
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Get tile data asynchronously with callback support
   * Returns cached data immediately or empty data, triggers callback when async data arrives
   */
  public getTileDataAsync(
    tile: IFeatureTile,
    callback: TileDataCallback,
    dataType: 'real' | 'model' = 'real',
    options?: {
      imageName?: string;
      overlayName?: string;
      dataset?: string;
      endpointName?: string;
    }
  ): IFeatureTileData {
    const tileId = this.getTileId(tile, dataType, options);

    // Return cached data immediately if available
    if (this.featureCache.has(tileId)) {
      const cached = this.featureCache.get(tileId)!;
      return { features: cached.features, byteLength: cached.byteLength };
    }

    // Add callback to notification list
    if (!this.dataChangeCallbacks.has(tileId)) {
      this.dataChangeCallbacks.set(tileId, new Set());
    }
    this.dataChangeCallbacks.get(tileId)!.add(callback);

    // Start loading if not already in progress
    if (!this.loadingPromises.has(tileId)) {
      this.startAsyncTileLoad(tile, dataType, options, tileId);
    }

    // Return empty data immediately - callback will be triggered when data arrives
    return { features: [], byteLength: 0 };
  }

  /**
   * Create a feature data function that uses the comm service
   */
  public createFeatureDataFunction(
    imageName: string,
    overlayName: string
  ): FeatureTileDataFunction {
    return async (tile: IFeatureTile): Promise<IFeatureTileData> => {
      return this.loadFeatureData(tile, imageName, overlayName);
    };
  }

  /**
   * Create a model feature data function that uses MODEL_TILE_REQUEST messages
   */
  public createModelFeatureDataFunction(
    dataset: string,
    endpointName: string
  ): FeatureTileDataFunction {
    return async (tile: IFeatureTile): Promise<IFeatureTileData> => {
      return this.loadModelFeatureData(tile, dataset, endpointName);
    };
  }

  /**
   * Load feature data from the kernel via comm service
   */
  private async loadFeatureData(
    tile: IFeatureTile,
    imageName: string,
    overlayName: string
  ): Promise<IFeatureTileData> {
    const tileKey = `${imageName}-${overlayName}-${tile.x}-${tile.y}-${tile.z}`;

    // Check cache first
    if (this.featureCache.has(tileKey)) {
      const cached = this.featureCache.get(tileKey)!;
      return { features: cached.features, byteLength: cached.byteLength };
    }

    if (!this.commService.isReady()) {
      const errorMessage = 'CommService not ready for feature loading';
      logger.error(`FeatureTileService feature load failed: ${errorMessage}`);
      console.error(errorMessage);
      return { features: [], byteLength: 0 };
    }

    try {
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
      const cacheEntry: IFeatureCacheEntry = {
        features: processedFeatures,
        byteLength,
        timestamp: Date.now(),
        tileKey
      };
      this.featureCache.set(tileKey, cacheEntry);

      return { features: processedFeatures, byteLength };
    } catch (error: any) {
      logger.error(
        `FeatureTileService feature tile load failed for ${tileKey}: ${error.message}`
      );
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
  ): Promise<IFeatureTileData> {
    const tileKey = `model-${dataset}-${endpointName}-${tile.x}-${tile.y}-${tile.z}`;

    // Check cache first
    if (this.featureCache.has(tileKey)) {
      const cached = this.featureCache.get(tileKey)!;
      return { features: cached.features, byteLength: cached.byteLength };
    }

    if (!this.commService.isReady()) {
      const errorMessage = 'CommService not ready for model feature loading';
      logger.error(
        `FeatureTileService model feature load failed: ${errorMessage}`
      );
      console.error(errorMessage);
      return { features: [], byteLength: 0 };
    }

    try {
      const response = await this.commService.sendMessage(
        {
          type: 'MODEL_TILE_REQUEST',
          dataset: dataset,
          endpointName: endpointName,
          zoom: tile.z,
          row: tile.y,
          col: tile.x
        },
        60000
      ); // 60 second timeout for model requests

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
      const cacheEntry: IFeatureCacheEntry = {
        features: processedFeatures,
        byteLength,
        timestamp: Date.now(),
        tileKey
      };
      this.featureCache.set(tileKey, cacheEntry);

      return { features: processedFeatures, byteLength };
    } catch (error: any) {
      logger.error(
        `FeatureTileService model feature tile load failed for ${tileKey}: ${error.message}`
      );
      console.error(`Error loading model features for tile ${tileKey}:`, error);
      return { features: [], byteLength: 0 };
    }
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
      return jsonString.length * 2 + features.length * 100; // 100 bytes overhead per feature
    } catch (error) {
      // Fallback: estimate based on feature count
      return features.length * 1000; // 1KB per feature as rough estimate
    }
  }

  /**
   * Generate a unique tile ID based on tile coordinates and data type
   */
  private getTileId(
    tile: IFeatureTile,
    dataType: string,
    options?: any
  ): string {
    switch (dataType) {
      case 'real':
        return `${options?.imageName || 'unknown'}-${options?.overlayName || 'unknown'}-${tile.x}-${tile.y}-${tile.z}`;
      case 'model':
        return `model-${options?.dataset || 'unknown'}-${options?.endpointName || 'unknown'}-${tile.x}-${tile.y}-${tile.z}`;
      default:
        return `${dataType}-${tile.x}-${tile.y}-${tile.z}`;
    }
  }

  /**
   * Start async loading of tile data
   */
  private startAsyncTileLoad(
    tile: IFeatureTile,
    dataType: 'real' | 'model',
    options: any = {},
    tileId: string
  ): void {
    let loadPromise: Promise<IFeatureTileData>;

    switch (dataType) {
      case 'real':
        if (!options.imageName || !options.overlayName) {
          console.error('Data loading requires imageName and overlayName');
          this.notifyCallbacks(tileId, { features: [], byteLength: 0 });
          return;
        }
        loadPromise = this.loadFeatureData(
          tile,
          options.imageName,
          options.overlayName
        );
        break;
      case 'model':
        if (!options.dataset || !options.endpointName) {
          console.error('Model data loading requires dataset and endpointName');
          this.notifyCallbacks(tileId, { features: [], byteLength: 0 });
          return;
        }
        loadPromise = this.loadModelFeatureData(
          tile,
          options.dataset,
          options.endpointName
        );
        break;
      default:
        console.error(`Unknown data type: ${dataType}`);
        this.notifyCallbacks(tileId, { features: [], byteLength: 0 });
        return;
    }

    this.loadingPromises.set(tileId, loadPromise);

    loadPromise
      .then(data => {
        this.notifyCallbacks(tileId, data);
      })
      .catch(error => {
        console.error(`Async load failed for tile ${tileId}:`, error);
        this.notifyCallbacks(tileId, { features: [], byteLength: 0 });
      })
      .finally(() => {
        // Clean up loading promise and callbacks
        this.loadingPromises.delete(tileId);
        this.dataChangeCallbacks.delete(tileId);
      });
  }

  /**
   * Notify all callbacks for a tile that data has arrived
   */
  private notifyCallbacks(tileId: string, data: IFeatureTileData): void {
    const callbacks = this.dataChangeCallbacks.get(tileId);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(tileId, data);
        } catch (error) {
          console.error('Error in tile data callback:', error);
        }
      });
    }
  }

  /**
   * Cancel loading for a specific tile
   */
  public cancelTileLoad(tileId: string): void {
    this.loadingPromises.delete(tileId);
    this.dataChangeCallbacks.delete(tileId);
  }

  /**
   * Clear the feature cache and cancel all loading operations
   */
  public clearCache(): void {
    this.featureCache.clear();
    this.loadingPromises.clear();
    this.dataChangeCallbacks.clear();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): {
    size: number;
    keys: string[];
    totalFeatures: number;
  } {
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
   * Dispose of the service and clean up resources
   */
  public dispose(): void {
    this.clearCache();
  }
}

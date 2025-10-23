// Copyright Amazon.com, Inc. or its affiliates.

import { ITile, TileDataFunction, ITileLoadConfig } from '../types';
import { CommService } from './CommService';

/**
 * Interface for image load response
 */
export interface IImageLoadResponse {
  success: boolean;
  status: string;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Service for managing image tile data loading and caching
 */
export class ImageTileService {
  private tileCache: Map<string, ImageBitmap> = new Map();
  private config: Required<ITileLoadConfig>;

  constructor(
    private commService: CommService,
    config: ITileLoadConfig = {}
  ) {
    this.config = {
      tileSize: 512,
      timeout: 10000,
      maxRetries: 3,
      enableDebugLogging: false,
      ...config
    };
  }

  /**
   * Load an image and get its metadata
   */
  public async loadImage(imageName: string): Promise<IImageLoadResponse> {
    if (!this.commService.isReady()) {
      this.debugLog('CommService not ready for image loading');
      return {
        success: false,
        status: 'COMM_NOT_READY',
        error: 'Communication service not ready'
      };
    }

    try {
      this.debugLog(`Loading image: ${imageName}`);

      const response = await this.commService.sendMessage({
        type: 'IMAGE_LOAD_REQUEST',
        dataset: imageName
      });

      // Check if the image load was successful
      if (response.status !== 'SUCCESS') {
        this.debugLog(`Image load failed for ${imageName}`, response);
        return {
          success: false,
          status: response.status || 'UNKNOWN_ERROR',
          error: `Image could not be loaded as an image (Status: ${response.status})`
        };
      }

      this.debugLog(`Image loaded successfully: ${imageName}`, {
        width: response.width,
        height: response.height
      });

      return {
        success: true,
        status: response.status,
        width: response.width,
        height: response.height
      };
    } catch (error: any) {
      console.error(`Error loading image ${imageName}:`, error);
      this.debugLog(`Image load error for ${imageName}`, error);
      return {
        success: false,
        status: 'ERROR',
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Create a tile data function that uses the comm service
   */
  public createTileDataFunction(imageName: string): TileDataFunction {
    return async (tile: ITile): Promise<ImageBitmap | null> => {
      return this.loadTileData(tile, imageName);
    };
  }

  /**
   * Load tile data from the kernel via comm service
   */
  private async loadTileData(
    tile: ITile,
    imageName: string
  ): Promise<ImageBitmap | null> {
    const tileKey = `${imageName}-${tile.x}-${tile.y}-${tile.z}`;

    // Check cache first
    if (this.tileCache.has(tileKey)) {
      this.debugLog(`Using cached real tile: ${tileKey}`);
      return this.tileCache.get(tileKey)!;
    }

    if (!this.commService.isReady()) {
      console.error('CommService not ready for tile loading');
      return null;
    }

    try {
      this.debugLog(`Loading real tile: ${tileKey}`);

      const response = await this.commService.sendMessage({
        type: 'IMAGE_TILE_REQUEST',
        dataset: imageName,
        zoom: tile.z,
        row: tile.y,
        col: tile.x
      });

      const base64Data = response.img;
      if (!base64Data) {
        console.error(`No image data received for tile ${tileKey}`);
        return null;
      }

      const dataUrl = `data:image/png;base64,${base64Data}`;

      // Convert data URL to ImageBitmap
      const img = new Image();
      return new Promise(resolve => {
        img.onload = async () => {
          try {
            const imageBitmap = await createImageBitmap(img);
            // Add byteLength property for Deck.gl compatibility
            (imageBitmap as any).byteLength =
              imageBitmap.width * imageBitmap.height * 4;

            // Cache the result
            this.tileCache.set(tileKey, imageBitmap);

            this.debugLog(`Loaded real tile: ${tileKey}`);
            resolve(imageBitmap);
          } catch (error) {
            console.error('Error creating ImageBitmap from tile data:', error);
            resolve(null);
          }
        };

        img.onerror = () => {
          console.error(`Failed to load image for tile ${tileKey}`);
          resolve(null);
        };

        img.src = dataUrl;
      });
    } catch (error) {
      console.error(`Error loading tile ${tileKey}:`, error);
      return null;
    }
  }

  /**
   * Clear the tile cache
   */
  public clearCache(): void {
    // Dispose of ImageBitmaps to free memory
    for (const imageBitmap of this.tileCache.values()) {
      if (imageBitmap.close) {
        imageBitmap.close();
      }
    }
    this.tileCache.clear();
    this.debugLog('Tile cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.tileCache.size,
      keys: Array.from(this.tileCache.keys())
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ITileLoadConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Debug logging utility
   */
  private debugLog(message: string, data?: any): void {
    if (this.config.enableDebugLogging) {
      console.log(`[ImageTileService] ${message}`, data || '');
    }
  }

  /**
   * Dispose of the service and clean up resources
   */
  public dispose(): void {
    this.clearCache();
  }
}

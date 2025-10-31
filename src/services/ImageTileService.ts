// Copyright Amazon.com, Inc. or its affiliates.

import {
  ITile,
  TileDataFunction,
  ITileLoadConfig,
  IImageMetadataResponse
} from '../types';
import { CommService } from './CommService';
import { logger } from '../utils';

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
      ...config
    };
  }

  /**
   * Load an image and get its metadata
   */
  public async loadImage(imageName: string): Promise<IImageLoadResponse> {
    if (!this.commService.isReady()) {
      const errorMessage = 'Communication service not ready';
      logger.error(
        `ImageTileService loadImage failed for ${imageName}: ${errorMessage}`
      );
      return {
        success: false,
        status: 'COMM_NOT_READY',
        error: errorMessage
      };
    }

    try {
      const response = await this.commService.sendMessage({
        type: 'IMAGE_LOAD_REQUEST',
        dataset: imageName
      });

      // Check if the image load was successful
      if (response.status !== 'SUCCESS') {
        const errorMessage = `Image could not be loaded as an image (Status: ${response.status})`;
        logger.error(
          `ImageTileService loadImage failed for ${imageName}: ${response.status}`
        );
        return {
          success: false,
          status: response.status || 'UNKNOWN_ERROR',
          error: errorMessage
        };
      }

      return {
        success: true,
        status: response.status,
        width: response.width,
        height: response.height
      };
    } catch (error: any) {
      logger.error(
        `ImageTileService loadImage failed for ${imageName}: ${error.message}`
      );
      console.error(`Error loading image ${imageName}:`, error);
      return {
        success: false,
        status: 'ERROR',
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Load image metadata
   */
  public async loadImageMetadata(
    imageName: string
  ): Promise<IImageMetadataResponse> {
    if (!this.commService.isReady()) {
      const errorMessage = 'Communication service not ready';
      logger.error(
        `ImageTileService loadImageMetadata failed for ${imageName}: ${errorMessage}`
      );
      return {
        success: false,
        error: errorMessage
      };
    }

    try {
      const response = await this.commService.sendMessage({
        type: 'IMAGE_METADATA_REQUEST',
        dataset: imageName
      });

      if (response.status === 'SUCCESS' && response.metadata) {
        return {
          success: true,
          metadata: response.metadata
        };
      } else {
        const errorMessage = response.error || 'Failed to fetch metadata';
        logger.error(
          `ImageTileService loadImageMetadata failed for ${imageName}: ${errorMessage}`
        );
        return {
          success: false,
          error: errorMessage
        };
      }
    } catch (error: any) {
      logger.error(
        `ImageTileService loadImageMetadata failed for ${imageName}: ${error.message}`
      );
      console.error(`Error loading metadata for ${imageName}:`, error);
      return {
        success: false,
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
      return this.tileCache.get(tileKey)!;
    }

    if (!this.commService.isReady()) {
      const errorMessage = 'CommService not ready for tile loading';
      logger.error(`ImageTileService tile load failed: ${errorMessage}`);
      console.error(errorMessage);
      return null;
    }

    try {
      const response = await this.commService.sendMessage({
        type: 'IMAGE_TILE_REQUEST',
        dataset: imageName,
        zoom: tile.z,
        row: tile.y,
        col: tile.x
      });

      const base64Data = response.img;
      if (!base64Data) {
        const errorMessage = `No image data received for tile ${tileKey}`;
        logger.error(`ImageTileService tile load failed: ${errorMessage}`);
        console.error(errorMessage);
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

            resolve(imageBitmap);
          } catch (error: any) {
            const errorMessage = `Error creating ImageBitmap from tile data: ${error.message}`;
            logger.error(
              `ImageTileService tile processing failed for ${tileKey}: ${errorMessage}`
            );
            console.error('Error creating ImageBitmap from tile data:', error);
            resolve(null);
          }
        };

        img.onerror = () => {
          const errorMessage = `Failed to load image for tile ${tileKey}`;
          logger.error(
            `ImageTileService tile image load failed: ${errorMessage}`
          );
          console.error(errorMessage);
          resolve(null);
        };

        img.src = dataUrl;
      });
    } catch (error: any) {
      logger.error(
        `ImageTileService tile request failed for ${tileKey}: ${error.message}`
      );
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
   * Dispose of the service and clean up resources
   */
  public dispose(): void {
    this.clearCache();
  }
}

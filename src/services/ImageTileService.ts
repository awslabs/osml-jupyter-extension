// Copyright Amazon.com, Inc. or its affiliates.

import { ITile, TileDataFunction, ITileLoadConfig } from '../types';
import { CommService } from './CommService';

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
   * Create a mock tile data function for testing
   */
  public createMockTileDataFunction(): TileDataFunction {
    return async (tile: ITile): Promise<ImageBitmap | null> => {
      return this.createMockTileData(tile);
    };
  }

  /**
   * Create a real tile data function that uses the comm service
   */
  public createRealTileDataFunction(imageName: string): TileDataFunction {
    return async (tile: ITile): Promise<ImageBitmap | null> => {
      return this.loadRealTileData(tile, imageName);
    };
  }

  /**
   * Generate mock tile data for testing/debugging
   */
  private async createMockTileData(tile: ITile): Promise<ImageBitmap | null> {
    const tileKey = `${tile.x}-${tile.y}-${tile.z}`;

    // Check cache first
    if (this.tileCache.has(tileKey)) {
      this.debugLog(`Using cached mock tile: ${tileKey}`);
      return this.tileCache.get(tileKey)!;
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.config.tileSize;
    canvas.height = this.config.tileSize;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return null;
    }

    // Save context state
    ctx.save();

    // Fill with gray background
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, this.config.tileSize, this.config.tileSize);

    // Add border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, this.config.tileSize - 2, this.config.tileSize - 2);

    // Add coordinates text
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `${tile.x},${tile.y},${tile.z}`,
      this.config.tileSize / 2,
      this.config.tileSize / 2
    );

    // Restore context
    ctx.restore();

    try {
      // Convert canvas to ImageBitmap
      const imageBitmap = await createImageBitmap(canvas);
      // Add byteLength property for Deck.gl compatibility
      (imageBitmap as any).byteLength =
        this.config.tileSize * this.config.tileSize * 4; // RGBA bytes

      // Cache the result
      this.tileCache.set(tileKey, imageBitmap);

      this.debugLog(`Created mock tile: ${tileKey}`);
      return imageBitmap;
    } catch (error) {
      console.error('Error creating mock tile ImageBitmap:', error);
      return null;
    }
  }

  /**
   * Load real tile data from the kernel via comm service
   */
  private async loadRealTileData(
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

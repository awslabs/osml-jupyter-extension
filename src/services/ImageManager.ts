// Copyright Amazon.com, Inc. or its affiliates.

import { Signal } from '@lumino/signaling';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

import { ITile, TileDataFunction, IImageInfo } from '../types';
import { ImageTileService } from './ImageTileService';
import { logger } from '../utils';

/**
 * Interface for image metadata
 */
export interface IImageMetadata {
  name: string;
  width: number;
  height: number;
  bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

/**
 * Interface for viewport state
 */
export interface IViewportState {
  target: [number, number, number];
  zoom: number;
  minZoom: number;
  maxZoom: number;
}

/**
 * ImageManager handles all image-related operations including loading,
 * layer creation, and viewport management for the ImageViewerWidget
 */
export class ImageManager {
  private currentImage: IImageMetadata | null = null;
  private imageLayer: TileLayer | null = null;
  private currentGetTileData: TileDataFunction | null = null;
  private tileSize: number = 512;

  // Signal emitted when a new image is loaded or cleared, now with rich metadata
  public readonly imageChanged: Signal<ImageManager, IImageInfo> = new Signal<
    ImageManager,
    IImageInfo
  >(this);

  constructor(private imageTileService: ImageTileService) {}

  /**
   * Load an image and create its layer, handling all tile service operations internally.
   * This method will:
   * 1. Load image metadata from the ImageTileService to get dimensions
   * 2. Create a tile data function using the ImageTileService
   * 3. Create the image layer with the tile data function
   * 4. Emit imageChanged signals for property inspector updates
   *
   * @param imageName - The name/path of the image to load
   * @throws {Error} If the image cannot be loaded or if required metadata is missing
   */
  public async loadImage(imageName: string): Promise<void> {
    logger.debug(`ImageManager loading image: ${imageName}`);

    try {
      // First, load image to get metadata and determine dimensions
      const imageLoadResponse =
        await this.imageTileService.loadImage(imageName);

      if (
        !imageLoadResponse.success ||
        !imageLoadResponse.width ||
        !imageLoadResponse.height
      ) {
        const errorMessage = `Could not load image: ${imageName} - ${imageLoadResponse.error || 'Unknown error'}`;
        logger.error(`ImageManager loadImage failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      const imageWidth = imageLoadResponse.width;
      const imageHeight = imageLoadResponse.height;

      logger.debug(
        `ImageManager loaded image metadata: ${imageName} (${imageWidth}x${imageHeight})`
      );

      // Create image metadata
      const imageMetadata: IImageMetadata = {
        name: imageName,
        width: imageWidth,
        height: imageHeight,
        bounds: {
          left: 0,
          top: 0,
          right: imageWidth,
          bottom: imageHeight
        }
      };

      // Create a getTileData function using the ImageTileService
      const getTileData =
        this.imageTileService.createTileDataFunction(imageName);

      // Store current image and getTileData function
      this.currentImage = imageMetadata;
      this.currentGetTileData = getTileData;

      // Create the image layer with the tile data function
      this.createImageLayer(imageName, getTileData);

      logger.info(`ImageManager successfully loaded image: ${imageName}`);

      // Emit initial loading state and asynchronously load detailed metadata
      this.emitImageInfoChanged(imageName);
    } catch (error: any) {
      logger.error(
        `ImageManager failed to load image ${imageName}: ${error.message}`
      );
      throw error; // Re-throw to allow caller to handle
    }
  }

  /**
   * Create a TileLayer for the image with provided getTileData function
   */
  private createImageLayer(
    imageName: string,
    getTileData: TileDataFunction
  ): void {
    this.imageLayer = new TileLayer({
      id: `image-${imageName}`,
      data: [], // Required by TileLayer but not used since we provide getTileData
      tileSize: this.tileSize,
      minZoom: -10,
      maxZoom: 10,
      maxCacheSize: 100,
      maxCacheByteSize: 50 * 1024 * 1024, // 50MB cache
      refinementStrategy: 'best-available',
      debounceTime: 100,
      getTileData: (tileProps: any) => {
        // Extract tile coordinates from TileLoadProps
        const x = tileProps.x ?? tileProps.index?.x;
        const y = tileProps.y ?? tileProps.index?.y;
        const z = tileProps.z ?? tileProps.index?.z;

        // Convert TileLayer's tile format to our ITile format
        const scale = Math.pow(2, -z);
        const tileSize = this.tileSize;
        const tile: ITile = {
          x,
          y,
          z,
          left: x * tileSize * scale,
          top: y * tileSize * scale,
          right: (x + 1) * tileSize * scale,
          bottom: (y + 1) * tileSize * scale
        };

        return getTileData(tile);
      },
      renderSubLayers: (props: any) => {
        const { tile, data } = props;

        if (!data) {
          return null;
        }

        // Extract tile bounds from the tile's bbox
        const { bbox } = tile;
        let bounds: number[];

        if ('west' in bbox) {
          // Geographic bounds format
          bounds = [bbox.west, bbox.south, bbox.east, bbox.north];
        } else {
          // Image coordinate bounds format
          bounds = [bbox.left, bbox.bottom, bbox.right, bbox.top];
        }

        return new BitmapLayer({
          ...props,
          id: `${props.id}-bitmap`,
          image: data,
          bounds,
          data: null // Explicitly set data to null to avoid BitmapLayer confusion
        });
      },
      onTileLoad: (tile: any) => {},
      onTileError: (error: any, tile?: any) => {
        const tileInfo = tile ? `${tile.x}-${tile.y}-${tile.z}` : 'unknown';
        console.error(`Tile error for ${tileInfo}:`, error);
      }
    });
  }

  /**
   * Clear the current image and layer
   */
  public clearImage(): void {
    this.currentImage = null;
    this.imageLayer = null;

    // Emit signal to notify listeners that image has been cleared
    this.imageChanged.emit({});
  }

  /**
   * Load image metadata and emit signal for property inspector
   */
  private async emitImageInfoChanged(imageName: string): Promise<void> {
    // Emit initial loading state
    this.imageChanged.emit({
      name: imageName,
      isLoadingMetadata: true
    });

    try {
      const response = await this.imageTileService.loadImageMetadata(imageName);

      if (response.success && response.metadata) {
        // Emit success state with metadata
        this.imageChanged.emit({
          name: imageName,
          metadata: response.metadata,
          isLoadingMetadata: false
        });
      } else {
        // Emit error state
        this.imageChanged.emit({
          name: imageName,
          metadataError: response.error || 'Failed to fetch metadata',
          isLoadingMetadata: false
        });
      }
    } catch (error: any) {
      // Emit error state
      this.imageChanged.emit({
        name: imageName,
        metadataError: error.message,
        isLoadingMetadata: false
      });
    }
  }

  /**
   * Get the current image metadata
   */
  public getCurrentImage(): IImageMetadata | null {
    return this.currentImage;
  }

  /**
   * Get the current image name
   */
  public getCurrentImageName(): string | null {
    return this.currentImage?.name || null;
  }

  /**
   * Get the current image dimensions
   */
  public getImageDimensions(): { width: number; height: number } | null {
    if (!this.currentImage) {
      return null;
    }
    return {
      width: this.currentImage.width,
      height: this.currentImage.height
    };
  }

  /**
   * Check if an image is currently loaded
   */
  public isImageLoaded(): boolean {
    return this.currentImage !== null;
  }

  /**
   * Get the current image layer
   */
  public getImageLayer(): TileLayer | null {
    return this.imageLayer;
  }

  /**
   * Calculate initial viewport state for the current image
   */
  public getInitialViewState(): IViewportState | null {
    if (!this.currentImage) {
      return null;
    }

    const centerX = this.currentImage.width / 2;
    const centerY = this.currentImage.height / 2;

    return {
      target: [centerX, centerY, 0],
      zoom: 0, // Start at full resolution (zoom level 0)
      minZoom: -10,
      maxZoom: 10
    };
  }

  /**
   * Set tile size (affects layer creation)
   */
  public setTileSize(tileSize: number): void {
    if (this.tileSize !== tileSize) {
      this.tileSize = tileSize;

      // Recreate image layer if image is loaded
      if (this.currentImage && this.currentGetTileData) {
        this.createImageLayer(this.currentImage.name, this.currentGetTileData);
      }
    }
  }

  /**
   * Get current tile size
   */
  public getTileSize(): number {
    return this.tileSize;
  }

  /**
   * Get debug information about the current state
   */
  public getDebugInfo(): any {
    return {
      hasImage: this.isImageLoaded(),
      imageName: this.getCurrentImageName(),
      dimensions: this.getImageDimensions(),
      tileSize: this.tileSize,
      hasLayer: !!this.imageLayer
    };
  }

  /**
   * Dispose of the image manager and clean up resources
   */
  public dispose(): void {
    // Clear current state
    this.currentImage = null;
    this.imageLayer = null;
  }
}

// Copyright Amazon.com, Inc. or its affiliates.

import { Signal } from '@lumino/signaling';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

import { ITile, TileDataFunction } from '../types';
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

  // Signals for image changes
  private _imageChanged = new Signal<ImageManager, void>(this);
  private _imageLoaded = new Signal<ImageManager, IImageMetadata>(this);
  private _imageLoadError = new Signal<ImageManager, string>(this);

  constructor() {}

  /**
   * Signal emitted when image changes (load, clear)
   */
  get imageChanged(): Signal<ImageManager, void> {
    return this._imageChanged;
  }

  /**
   * Signal emitted when image loads successfully
   */
  get imageLoaded(): Signal<ImageManager, IImageMetadata> {
    return this._imageLoaded;
  }

  /**
   * Signal emitted when image load fails
   */
  get imageLoadError(): Signal<ImageManager, string> {
    return this._imageLoadError;
  }

  /**
   * Load an image and create its layer with provided metadata and tile data function
   */
  public loadImage(
    imageName: string,
    imageWidth: number,
    imageHeight: number,
    getTileData: TileDataFunction
  ): void {
    try {
      logger.debug(
        `ImageManager loading image: ${imageName} (${imageWidth}x${imageHeight})`
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

      // Store current image and getTileData function
      this.currentImage = imageMetadata;
      this.currentGetTileData = getTileData;

      // Create the image layer with provided getTileData function
      this.createImageLayer(imageName, getTileData);

      logger.info(`ImageManager successfully loaded image: ${imageName}`);

      // Emit signals
      this._imageLoaded.emit(imageMetadata);
      this._imageChanged.emit();
    } catch (error: any) {
      const errorMessage = `Error loading ${imageName}: ${error.message}`;
      logger.error(
        `ImageManager loadImage failed for ${imageName}: ${error.message}`
      );
      console.error('Error loading image:', error);
      this._imageLoadError.emit(errorMessage);
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

    this._imageChanged.emit();
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
        this._imageChanged.emit();
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

    // Clear signals
    Signal.clearData(this);
  }
}

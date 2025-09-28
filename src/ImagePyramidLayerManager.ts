import { Kernel } from '@jupyterlab/services';
import { DeckTileImageLayer } from './DeckTileImageLayer';
import { ITile, TileDataFunction } from './ImagePyramidTileDataFunctions';

/**
 * Configuration options for the ImagePyramidLayerManager
 */
export interface IImagePyramidLayerOptions {
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  opacity?: number;
  visible?: boolean;
  enableDebugLogging?: boolean;
  getTileData?: TileDataFunction;
}

/**
 * Manager class for DeckTileImageLayer instances.
 * Provides a simplified interface for creating and managing image pyramid layers.
 */
export class ImagePyramidLayerManager {
  private layer: DeckTileImageLayer | null = null;
  private updateCallback?: () => void;

  constructor(
    private comm: Kernel.IComm,
    private imageName: string,
    private options: IImagePyramidLayerOptions = {},
    updateCallback?: () => void
  ) {
    this.updateCallback = updateCallback;
    this.logDebug('ImagePyramidLayerManager initialized', {
      imageName: this.imageName,
      options: this.options,
      hasUpdateCallback: !!updateCallback
    });
  }

  /**
   * Debug logging utility for the manager
   */
  private logDebug(message: string, data?: any): void {
    if (this.options.enableDebugLogging) {
      console.log(`[ImagePyramidLayerManager] ${message}`, data || '');
    }
  }

  /**
   * Create and return the DeckTileImageLayer instance.
   */
  public getLayer(): DeckTileImageLayer {
    if (!this.layer) {
      
      this.layer = new DeckTileImageLayer({
        id: `image-pyramid-${this.imageName}`,
        data: [], // Required by TileLayer but not used since we provide getTileData
        comm: this.comm,
        imageName: this.imageName,
        tileSize: this.options.tileSize || 512,
        minZoom: this.options.minZoom || -10,
        maxZoom: this.options.maxZoom || 10,
        opacity: this.options.opacity || 1.0,
        visible: this.options.visible !== false,
        enableDebugLogging: this.options.enableDebugLogging || false,
        getTileData: this.options.getTileData, // This will be handled by DeckTileImageLayer's conversion
        // Additional TileLayer optimizations
        maxCacheSize: 100,
        maxCacheByteSize: 50 * 1024 * 1024, // 50MB cache
        refinementStrategy: 'best-available',
        debounceTime: 100
      } as any); // Type assertion to bypass the getTileData type mismatch
      
      this.logDebug('Layer created', {
        layerId: this.layer.id,
        hasTileDataFunction: !!this.options.getTileData
      });
    }
    return this.layer;
  }

  /**
   * Clear the tile cache to free memory.
   */
  public clearCache(): void {
    if (this.layer) {
      this.layer.clearCache();
      this.logDebug('Cache cleared');
    }
  }

  /**
   * Get cache statistics for debugging.
   */
  public getCacheStats(): { size: number; loading: number } {
    if (this.layer) {
      return this.layer.getCacheStats();
    }
    return { size: 0, loading: 0 };
  }

  /**
   * Update layer options and force recreation.
   */
  public updateOptions(newOptions: Partial<IImagePyramidLayerOptions>): void {
    this.options = { ...this.options, ...newOptions };
    // Force recreation of layer with new options
    this.layer = null;
    this.logDebug('Options updated, layer will be recreated', { newOptions });
  }

  /**
   * Get current layer options.
   */
  public getOptions(): IImagePyramidLayerOptions {
    return { ...this.options };
  }

  /**
   * Print comprehensive debug information to console.
   */
  public printDebugInfo(): void {
    console.group(`[ImagePyramidLayerManager] Debug Info for ${this.imageName}`);
    console.log('Layer Options:', this.options);
    console.log('Cache Stats:', this.getCacheStats());
    console.log('Layer Created:', !!this.layer);
    if (this.layer) {
      console.log('Layer ID:', this.layer.id);
      console.log('Layer Props:', this.layer.props);
    }
    console.groupEnd();
  }

  /**
   * Enable/disable debug mode quickly.
   */
  public setDebugMode(enabled: boolean): void {
    this.updateOptions({ enableDebugLogging: enabled });
  }

  /**
   * Set layer opacity.
   */
  public setOpacity(opacity: number): void {
    this.updateOptions({ opacity: Math.max(0, Math.min(1, opacity)) });
  }

  /**
   * Set layer visibility.
   */
  public setVisible(visible: boolean): void {
    this.updateOptions({ visible });
  }

  /**
   * Get the image name this manager is handling.
   */
  public getImageName(): string {
    return this.imageName;
  }

  /**
   * Dispose of resources.
   */
  public dispose(): void {
    this.clearCache();
    this.layer = null;
    this.logDebug('Manager disposed');
  }
}

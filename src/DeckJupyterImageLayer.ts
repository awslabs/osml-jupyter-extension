import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import { Kernel } from '@jupyterlab/services';
import { IDeckImageLayerOptions } from './IDeckImageLayerOptions';

/**
 * Debug configuration for tile visualization
 */
interface IDebugConfig {
  enabled: boolean;
  showTileBoundaries: boolean;
  showTileCoordinates: boolean;
  logTileRequests: boolean;
  logCoordinateTransforms: boolean;
  logRenderingDetails: boolean;
}

/**
 * Default debug configuration - ALWAYS ENABLED for debugging tile issues
 */
const DEFAULT_DEBUG_CONFIG: IDebugConfig = {
  enabled: true, // Enable by default for debugging
  showTileBoundaries: true,
  showTileCoordinates: true,
  logTileRequests: true,
  logCoordinateTransforms: true,
  logRenderingDetails: true
};


/**
 * Creates a mock tile image for debugging purposes.
 * The image is filled with gray pixels, has a one-pixel black border,
 * and displays the tile coordinates in the center.
 * 
 * @param x Tile X coordinate
 * @param y Tile Y coordinate  
 * @param z Tile zoom level
 * @param size Tile size in pixels (default 512)
 * @param flipY Whether the view has flipY enabled (default true to match OrthographicView)
 */
function createMockTileImage(x: number, y: number, z: number, size: number = 512, flipY: boolean = true): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    return '';
  }

  // Save the current context state
  ctx.save();
  
  // If flipY is enabled, we need to flip the canvas vertically to counteract
  // the view's Y-axis flip, so text appears right-side up
  if (flipY) {
    ctx.scale(1, -1);
    ctx.translate(0, -size);
  }

  // Fill with gray background
  ctx.fillStyle = '#808080'; // Medium gray
  ctx.fillRect(0, 0, size, size);
  
  // Add one-pixel black border
  ctx.strokeStyle = '#000000'; // Black
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1); // Offset by 0.5 for crisp 1px line
  
  // Add tile coordinates text in the center
  ctx.fillStyle = '#000000'; // Black text
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${x},${y},${z}`, size / 2, size / 2);
  
  // Restore the context state
  ctx.restore();
  
  return canvas.toDataURL('image/png');
}

/**
 * Factory function for creating a Deck.gl TileLayer that renders satellite imagery tiles from a Jupyter Kernel.
 * This replaces the Leaflet-based JupyterImageLayer with a WebGL-based implementation.
 */
export function createDeckJupyterImageLayer(
  comm: Kernel.IComm,
  imageName: string,
  options: IDeckImageLayerOptions = {},
  debugConfig: IDebugConfig = DEFAULT_DEBUG_CONFIG
): TileLayer {
  const tileCache = new Map<string, string>();
  const tileMetrics = new Map<string, { requestTime: number; responseTime?: number; dataSize?: number }>();

  /**
   * Debug logging utility
   */
  const debugLog = (category: keyof IDebugConfig, message: string, data?: any) => {
    if (debugConfig.enabled && debugConfig[category]) {
      console.log(`[DECK-DEBUG-${category.toUpperCase()}] ${message}`, data || '');
    }
  };

  /**
   * Mock tile data function for debugging purposes.
   * Returns a Promise that resolves to a mock tile image with gray background,
   * black border, and tile coordinates in the center.
   */
  const getMockTileData = async (tile: any): Promise<string | null> => {
    const { x, y, z } = tile.index;
    const tileKey = `${x}-${y}-${z}`;
    
    debugLog('logTileRequests', `Generating mock tile for ${tileKey}`, {
      tile: tile,
      bbox: tile.bbox,
      extent: tile.extent
    });

    // Simulate some async delay like a real tile request
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Generate mock tile image
    const mockImage = createMockTileImage(x, y, z, options.tileSize || 512);
    
    debugLog('logTileRequests', `Generated mock tile ${tileKey}`, {
      imageDataLength: mockImage.length,
      tileSize: options.tileSize || 512
    });
    
    return mockImage;
  };

  /**
   * Fetches tile data from the Jupyter kernel via comm channel.
   * Returns a Promise that resolves to the tile image data.
   */
  const getTileData = async (tile: any): Promise<string | null> => {

    const { x, y, z } = tile.index;
    const tileKey = `${x}-${y}-${z}`;
    const requestStartTime = performance.now();
    
    debugLog('logTileRequests', `Starting tile request for ${tileKey}`, {
      tile: tile,
      bbox: tile.bbox,
      extent: tile.extent
    });
    
    // Check cache first
    if (tileCache.has(tileKey)) {
      debugLog('logTileRequests', `Cache HIT for tile ${tileKey}`);
      return tileCache.get(tileKey)!;
    }

    debugLog('logTileRequests', `Cache MISS for tile ${tileKey} - fetching from kernel`);
    
    // Store request timing
    tileMetrics.set(tileKey, { requestTime: requestStartTime });

    try {
      const tileData = await new Promise<string>((resolve, reject) => {
        const commFuture = comm.send({
          type: 'IMAGE_TILE_REQUEST',
          dataset: imageName,
          zoom: z,
          row: y,
          col: x
        });

        debugLog('logTileRequests', `Sent comm request for tile ${tileKey}`, {
          dataset: imageName,
          zoom: z,
          row: y,
          col: x
        });

        // Set a timeout to reject the promise if we don't get a response
        const timeoutId = setTimeout(() => {
          debugLog('logTileRequests', `TIMEOUT waiting for tile ${tileKey} response`);
          reject(new Error('Timeout waiting for tile response'));
        }, 10000); // 10 second timeout

        commFuture.onIOPub = (msg: any): void => {
          const msgType = msg.header.msg_type;
          if (msgType === 'comm_msg') {
            const responseTime = performance.now();
            const base64Data = msg.content.data.img;
            const dataUrl = `data:image/png;base64,${base64Data}`;
            
            // Update metrics
            const metrics = tileMetrics.get(tileKey);
            if (metrics) {
              metrics.responseTime = responseTime;
              metrics.dataSize = base64Data.length;
            }
            
            debugLog('logTileRequests', `Received tile ${tileKey} from comm`, {
              responseTimeMs: responseTime - requestStartTime,
              dataSizeBytes: base64Data.length,
              dataUrlLength: dataUrl.length
            });
            
            clearTimeout(timeoutId);
            resolve(dataUrl);
          }
        };

        // Handle comm future done with error
        commFuture.done.catch(error => {
          clearTimeout(timeoutId);
          debugLog('logTileRequests', `Comm future error for tile ${tileKey}`, error);
          reject(error);
        });
      });

      // Cache the tile data
      tileCache.set(tileKey, tileData);
      debugLog('logTileRequests', `Successfully cached tile ${tileKey}`);
      return tileData;
    } catch (error) {
      console.error(`Error fetching tile ${tileKey}:`, error);
      debugLog('logTileRequests', `ERROR fetching tile ${tileKey}`, error);
      return null;
    }
  };


  return new TileLayer({
    id: `jupyter-image-layer-${imageName}`,
    minZoom: options.minZoom || 0,
    maxZoom: options.maxZoom || 16,
    tileSize: options.tileSize || 512,
    opacity: options.opacity || 1.0,
    visible: options.visible !== false,
    
    // Custom tile loading function
    getTileData: getMockTileData,
    
    renderSubLayers: (props: any) => {
      const { tile } = props;
      const { x, y, z } = tile?.index || {};
      const tileKey = `${x}-${y}-${z}`;
      
      debugLog('logRenderingDetails', `renderSubLayers called for tile ${tileKey}`, {
        tile: tile,
        tileData: tile?.data ? 'present' : 'missing',
        tileDataType: typeof tile?.data,
        props: Object.keys(props)
      });

      // Get tile bounds - Match kernel-setup.py coordinate system
      const tileSize = options.tileSize || 512;

      const left = x * tileSize;
      const top = y * tileSize;
      const right = (x + 1) * tileSize;
      const bottom = (y + 1) * tileSize;
      
      const layers: any[] = [];
      
      // Add bitmap layer only if we have tile data
      if (tile && tile.data) {

        debugLog('logRenderingDetails', `Drawing Image for tile ${tileKey}`, [left, top, right, bottom])

        const bitmapLayer = new BitmapLayer({
          ...props,
          id: `${props.id}-bitmap-${x}-${y}-${z}`,
          image: tile.data,
          bounds: [left, top, right, bottom],
          // Provide empty data array to satisfy BitmapLayer's data requirements
          data: [{ position: [0, 0] }],
          // Override getPosition to return a valid position
          getPosition: () => [0, 0]
        });
        
        debugLog('logRenderingDetails', `Created BitmapLayer for tile ${tileKey}`, {
          layerId: bitmapLayer.id,
          bounds: [left, top, right, bottom],
          imageData: tile.data.substring(0, 50) + '...' // First 50 chars of data URL
        });
        
        layers.push(bitmapLayer);
      } else {
        debugLog('logRenderingDetails', `No tile data for ${tileKey} - showing debug visualization only`);
      }
      
      debugLog('logRenderingDetails', `Returning ${layers.length} layers for tile ${tileKey} (${tile?.data ? 'with data' : 'NO DATA'})`);
      return layers.length > 0 ? layers : null;
    }
  });
}

/**
 * Utility class for managing Deck.gl-based Jupyter image layers.
 * Provides methods for cache management and layer configuration.
 */
export class DeckJupyterImageLayerManager {
  private tileCache: Map<string, string> = new Map();
  private layer: TileLayer | null = null;
  private debugConfig: IDebugConfig;
  private performanceMetrics: {
    layerCreationTime?: number;
    totalTileRequests: number;
    successfulTileRequests: number;
    failedTileRequests: number;
    averageResponseTime: number;
    cacheHitRate: number;
  } = {
    totalTileRequests: 0,
    successfulTileRequests: 0,
    failedTileRequests: 0,
    averageResponseTime: 0,
    cacheHitRate: 0
  };

  constructor(
    private comm: Kernel.IComm,
    private imageName: string,
    private options: IDeckImageLayerOptions = {},
    debugConfig: Partial<IDebugConfig> = {}
  ) {
    this.debugConfig = { ...DEFAULT_DEBUG_CONFIG, ...debugConfig };
    this.logDebug('Manager initialized', {
      imageName: this.imageName,
      options: this.options,
      debugConfig: this.debugConfig
    });
  }

  /**
   * Debug logging utility for the manager
   */
  private logDebug(message: string, data?: any): void {
    if (this.debugConfig.enabled) {
      console.log(`[DECK-MANAGER] ${message}`, data || '');
    }
  }

  /**
   * Create and return the Deck.gl layer.
   */
  public getLayer(): TileLayer {
    if (!this.layer) {
      const startTime = performance.now();
      this.layer = createDeckJupyterImageLayer(this.comm, this.imageName, this.options, this.debugConfig);
      this.performanceMetrics.layerCreationTime = performance.now() - startTime;
      
      this.logDebug('Layer created', {
        layerId: this.layer.id,
        creationTimeMs: this.performanceMetrics.layerCreationTime
      });
    }
    return this.layer;
  }

  /**
   * Clear the tile cache to free memory.
   */
  public clearCache(): void {
    const cacheSize = this.tileCache.size;
    this.tileCache.clear();
    this.logDebug('Cache cleared', { previousSize: cacheSize });
  }

  /**
   * Get cache size for debugging.
   */
  public getCacheSize(): number {
    return this.tileCache.size;
  }

  /**
   * Update layer options.
   */
  public updateOptions(newOptions: Partial<IDeckImageLayerOptions>): void {
    this.options = { ...this.options, ...newOptions };
    // Force recreation of layer with new options
    this.layer = null;
    this.logDebug('Options updated, layer will be recreated', { newOptions });
  }

  /**
   * Update debug configuration.
   */
  public updateDebugConfig(newDebugConfig: Partial<IDebugConfig>): void {
    this.debugConfig = { ...this.debugConfig, ...newDebugConfig };
    // Force recreation of layer with new debug config
    this.layer = null;
    this.logDebug('Debug config updated, layer will be recreated', { newDebugConfig });
  }

  /**
   * Get current debug configuration.
   */
  public getDebugConfig(): IDebugConfig {
    return { ...this.debugConfig };
  }

  /**
   * Get performance metrics for debugging.
   */
  public getPerformanceMetrics(): typeof this.performanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Print comprehensive debug information to console.
   */
  public printDebugInfo(): void {
    console.group(`[DECK-MANAGER] Debug Info for ${this.imageName}`);
    console.log('Layer Options:', this.options);
    console.log('Debug Config:', this.debugConfig);
    console.log('Performance Metrics:', this.performanceMetrics);
    console.log('Cache Size:', this.getCacheSize());
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
    this.updateDebugConfig({ enabled });
  }

  /**
   * Toggle tile boundaries visibility.
   */
  public toggleTileBoundaries(): void {
    this.updateDebugConfig({ showTileBoundaries: !this.debugConfig.showTileBoundaries });
  }

  /**
   * Toggle tile coordinates visibility.
   */
  public toggleTileCoordinates(): void {
    this.updateDebugConfig({ showTileCoordinates: !this.debugConfig.showTileCoordinates });
  }

}

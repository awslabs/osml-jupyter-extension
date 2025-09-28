import { TileLayer, TileLayerProps } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import { Kernel } from '@jupyterlab/services';
import { ITile, TileDataFunction } from './ImagePyramidTileDataFunctions';

/**
 * Props for the DeckTileImageLayer
 */
interface DeckTileImageLayerProps extends Omit<TileLayerProps, 'data' | 'getTileData' | 'renderSubLayers'> {
  // Communication
  comm?: Kernel.IComm;
  imageName: string;
  
  // Tile configuration
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  
  // Rendering options
  opacity?: number;
  visible?: boolean;
  
  // Debug options
  showTileBoundaries?: boolean;
  showTileCoordinates?: boolean;
  enableDebugLogging?: boolean;
  
  // Tile data function (preserves existing interface)
  getTileData?: TileDataFunction;
}

/**
 * Extended props that include both TileLayer props and our custom props
 */
type ExtendedProps = DeckTileImageLayerProps & TileLayerProps;

/**
 * Deck.gl TileLayer-based implementation for displaying tiled image pyramids.
 * This replaces the custom ImagePyramidLayer with Deck.gl's optimized tile management.
 */
export class DeckTileImageLayer extends TileLayer<string> {
  static layerName = 'DeckTileImageLayer';
  
  static defaultProps = {
    ...TileLayer.defaultProps,
    tileSize: 512,
    minZoom: -10,
    maxZoom: 10,
    opacity: 1.0,
    visible: true,
    showTileBoundaries: false,
    showTileCoordinates: false,
    enableDebugLogging: false,
    maxCacheSize: 100,
    maxCacheByteSize: 50 * 1024 * 1024, // 50MB cache
    refinementStrategy: 'best-available',
    debounceTime: 100
  };

  /**
   * Debug logging utility
   */
  private debugLog(message: string, data?: any): void {
    if ((this.props as unknown as DeckTileImageLayerProps).enableDebugLogging) {
      console.log(`[DeckTileImageLayer] ${message}`, data || '');
    }
  }

  /**
   * Convert TileLayer's tile format to our ITile interface
   */
  private convertToITile(tileProps: any): ITile {
    // TileLayer passes different properties - let's extract them correctly
    const x = tileProps.x ?? tileProps.index?.x;
    const y = tileProps.y ?? tileProps.index?.y;  
    const z = tileProps.z ?? tileProps.index?.z;
    
    this.debugLog('Converting tile props', {
      tileProps,
      extractedCoords: { x, y, z }
    });
    
    const { tileSize = 512 } = this.props as unknown as DeckTileImageLayerProps;
    
    // Calculate tile bounds in image coordinates
    // This matches the logic from the original ImagePyramidLayer
    const scale = Math.pow(2, -z);
    const left = x * tileSize * scale;
    const top = y * tileSize * scale;
    const right = (x + 1) * tileSize * scale;
    const bottom = (y + 1) * tileSize * scale;
    
    return {
      x,
      y,
      z,
      left,
      top,
      right,
      bottom
    };
  }

  /**
   * Get tile data using the configured getTileData function
   */
  getTileData(tileProps: any): Promise<any> | any | null {
    const props = this.props as unknown as DeckTileImageLayerProps;
    
    if (!props.getTileData) {
      this.debugLog('No getTileData function provided');
      return null;
    }

    // Convert to our ITile format
    const tile = this.convertToITile(tileProps);
    
    this.debugLog(`Loading tile ${tile.x}-${tile.y}-${tile.z}`, {
      tileProps,
      convertedTile: tile
    });

    try {
      const result = props.getTileData(tile);
      
      // Handle both Promise and direct return values
      if (result instanceof Promise) {
        return result.then(data => {
          if (data) {
            this.debugLog(`Successfully loaded tile ${tile.x}-${tile.y}-${tile.z}`);
            // Return an object with the data and byteLength for TileLayer
            return {
              data,
              byteLength: this.estimateByteLength(data)
            };
          } else {
            this.debugLog(`getTileData returned null for tile ${tile.x}-${tile.y}-${tile.z}`);
            return null;
          }
        }).catch(error => {
          console.error(`Error loading tile ${tile.x}-${tile.y}-${tile.z}:`, error);
          this.debugLog(`Failed to load tile ${tile.x}-${tile.y}-${tile.z}`, error);
          throw error;
        });
      } else {
        if (result) {
          this.debugLog(`Successfully loaded tile ${tile.x}-${tile.y}-${tile.z} (sync)`);
          // Return an object with the data and byteLength for TileLayer
          return {
            data: result,
            byteLength: this.estimateByteLength(result)
          };
        } else {
          this.debugLog(`getTileData returned null for tile ${tile.x}-${tile.y}-${tile.z} (sync)`);
          return null;
        }
      }
    } catch (error) {
      console.error(`Error in getTileData for tile ${tile.x}-${tile.y}-${tile.z}:`, error);
      this.debugLog(`Exception in getTileData for tile ${tile.x}-${tile.y}-${tile.z}`, error);
      throw error;
    }
  }

  /**
   * Estimate byte length of tile data for cache management
   */
  private estimateByteLength(data: string): number {
    if (typeof data === 'string') {
      // For base64 data URLs, estimate the decoded size
      if (data.startsWith('data:')) {
        const base64Data = data.split(',')[1];
        return base64Data ? Math.floor(base64Data.length * 0.75) : 0;
      }
      // For other strings, use character count * 2 (assuming UTF-16)
      return data.length * 2;
    }
    return 0;
  }

  /**
   * Render sublayers for each tile
   */
  renderSubLayers(props: any) {
    const layerProps = this.props as unknown as DeckTileImageLayerProps;
    const { tile, data } = props;
    
    if (!data) {
      return null;
    }

    // Extract the actual image data from our wrapped data object
    const imageData = data.data || data;
    
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

    this.debugLog(`Rendering tile ${tile.x}-${tile.y}-${tile.z}`, {
      bounds,
      hasData: !!imageData,
      dataType: typeof imageData,
      tileCoords: { x: tile.x, y: tile.y, z: tile.z }
    });

    const layers = [];

    // Main bitmap layer
    const bitmapLayer = new BitmapLayer({
      ...props,
      id: `${props.id}-bitmap`,
      image: imageData,
      bounds,
      opacity: layerProps.opacity,
      visible: layerProps.visible,
      data: null // Explicitly set data to null to avoid BitmapLayer confusion
    });
    
    layers.push(bitmapLayer);

    // Optional tile boundaries for debugging
    if (layerProps.showTileBoundaries) {
      // TODO: Add tile boundary visualization layer
      // This could be implemented as a PathLayer or LineLayer
    }

    // Optional tile coordinates for debugging
    if (layerProps.showTileCoordinates) {
      // TODO: Add tile coordinate text layer
      // This could be implemented as a TextLayer
    }

    return layers;
  }

  /**
   * Handle tile load events for debugging
   */
  _onTileLoad(tile: any): void {
    this.debugLog(`Tile loaded: ${tile.x}-${tile.y}-${tile.z}`, {
      tileId: tile.id,
      isLoaded: tile.isLoaded,
      hasContent: !!tile.content
    });
    
    // Call parent implementation
    super._onTileLoad(tile);
  }

  /**
   * Handle tile error events for debugging
   */
  _onTileError(error: any, tile?: any): void {
    const tileInfo = tile ? `${tile.x}-${tile.y}-${tile.z}` : 'unknown';
    console.error(`Tile error for ${tileInfo}:`, error);
    this.debugLog(`Tile error for ${tileInfo}`, error);
    
    // Call parent implementation
    super._onTileError(error, tile);
  }

  /**
   * Handle viewport load events for debugging
   */
  _onViewportLoad(): void {
    const tileset = (this as any).state?.tileset;
    if (tileset?.selectedTiles) {
      const tiles = tileset.selectedTiles;
      this.debugLog(`Viewport loaded with ${tiles.length} tiles`, {
        tileIds: tiles.map((t: any) => `${t.x}-${t.y}-${t.z}`)
      });
    }
    
    // Call parent implementation
    super._onViewportLoad();
  }

  /**
   * Get cache statistics (for compatibility with original interface)
   */
  public getCacheStats(): { size: number; loading: number } {
    // Access the internal tileset if available
    const tileset = (this as any).state?.tileset;
    if (tileset) {
      const tiles = tileset.tiles || [];
      const loadingTiles = tiles.filter((t: any) => t.isLoading);
      return {
        size: tiles.length,
        loading: loadingTiles.length
      };
    }
    return { size: 0, loading: 0 };
  }

  /**
   * Clear the tile cache (for compatibility with original interface)
   */
  public clearCache(): void {
    const tileset = (this as any).state?.tileset;
    if (tileset && typeof tileset.reloadAll === 'function') {
      tileset.reloadAll();
      this.debugLog('Cache cleared via tileset.reloadAll()');
    } else {
      this.debugLog('Unable to clear cache - tileset not available');
    }
  }
}

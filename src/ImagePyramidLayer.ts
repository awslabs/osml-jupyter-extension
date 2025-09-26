import { CompositeLayer, Layer, LayerProps, Viewport } from '@deck.gl/core';
import { BitmapLayer } from '@deck.gl/layers';
import { Kernel } from '@jupyterlab/services';

/**
 * Interface for tile information
 */
interface ITile {
  x: number;
  y: number;
  z: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  data?: string; // Base64 image data
  loading?: boolean;
  error?: boolean;
}

/**
 * Props for the ImagePyramidLayer
 */
interface ImagePyramidLayerProps extends LayerProps {
  // Communication
  comm: Kernel.IComm;
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
  
  // Tile data function
  getTileData?: (tile: ITile) => Promise<string | null>;
}

/**
 * Custom Deck.gl layer for displaying tiled image pyramids.
 * This layer is specifically designed for image coordinate systems (not geographic).
 */
export class ImagePyramidLayer extends CompositeLayer<ImagePyramidLayerProps> {
  static layerName = 'ImagePyramidLayer';
  
  private tileCache = new Map<string, ITile>();
  private loadingTiles = new Set<string>();
  private lastViewState: any = null;
  private currentVisibleTiles: ITile[] = [];
  
  static defaultProps = {
    tileSize: 512,
    minZoom: -10,
    maxZoom: 10,
    opacity: 1.0,
    visible: true,
    showTileBoundaries: false,
    showTileCoordinates: false,
    enableDebugLogging: false
  };

  /**
   * Debug logging utility
   */
  private debugLog(message: string, data?: any): void {
    if (this.props.enableDebugLogging) {
      console.log(`[ImagePyramidLayer] ${message}`, data || '');
    }
  }

  /**
   * Determine if the layer should update its state based on changed props or context
   */
  shouldUpdateState({ changeFlags }: { changeFlags: any }): boolean {
    // Always update if viewport has changed
    if (changeFlags.viewportChanged) {
      this.debugLog('shouldUpdateState: viewport changed');
      return true;
    }

    // Update if any relevant props have changed
    if (changeFlags.propsChanged) {
      this.debugLog('shouldUpdateState: props changed');
      return true;
    }

    return false;
  }

  /**
   * Update the layer state when viewport or props change
   */
  updateState({ changeFlags }: { changeFlags: any }): void {
    const viewport = this.context.viewport;
    if (!viewport) {
      this.debugLog('updateState: no viewport available');
      return;
    }

    // Extract current view state from viewport properties
    // In Deck.gl, the viewport object contains the view state properties directly
    const currentViewState = {
      zoom: viewport.zoom,
      target: [viewport.center[0], viewport.center[1]], // Use center instead of target
      width: viewport.width,
      height: viewport.height
    };
    
    // Check if view state has actually changed
    const viewStateChanged = !this.lastViewState || 
      this.lastViewState.zoom !== currentViewState.zoom ||
      (this.lastViewState.target && currentViewState.target && (
        this.lastViewState.target[0] !== currentViewState.target[0] ||
        this.lastViewState.target[1] !== currentViewState.target[1]
      ));

    // Enhanced debugging for viewport changes
    this.debugLog('updateState called', {
      changeFlags: {
        viewportChanged: changeFlags.viewportChanged,
        propsChanged: changeFlags.propsChanged,
        extensionsChanged: changeFlags.extensionsChanged
      },
      viewStateChanged,
      viewport: {
        zoom: viewport.zoom,
        center: viewport.center,
        width: viewport.width,
        height: viewport.height
      },
      currentViewState,
      lastViewState: this.lastViewState
    });

    if (viewStateChanged || changeFlags.propsChanged) {
      this.debugLog('updateState: recalculating visible tiles', {
        reason: viewStateChanged ? 'viewport changed' : 'props changed',
        viewStateChanged,
        propsChanged: changeFlags.propsChanged,
        targetChange: this.lastViewState?.target && currentViewState.target ? {
          from: this.lastViewState.target,
          to: currentViewState.target,
          deltaX: currentViewState.target[0] - this.lastViewState.target[0],
          deltaY: currentViewState.target[1] - this.lastViewState.target[1]
        } : null,
        zoomChange: this.lastViewState ? {
          from: this.lastViewState.zoom,
          to: currentViewState.zoom,
          delta: currentViewState.zoom - this.lastViewState.zoom
        } : null
      });

      // Store the current view state
      this.lastViewState = {
        zoom: currentViewState.zoom,
        target: currentViewState.target ? [...currentViewState.target] : null
      };

      // Recalculate visible tiles
      const previousTileCount = this.currentVisibleTiles.length;
      this.currentVisibleTiles = this.calculateVisibleTiles(viewport);
      
      this.debugLog(`updateState: tile calculation complete`, {
        previousTileCount,
        newTileCount: this.currentVisibleTiles.length,
        tilesChanged: previousTileCount !== this.currentVisibleTiles.length
      });
    } else {
      this.debugLog('updateState: no changes detected, skipping tile recalculation');
    }
  }

  /**
   * Check if two tile sets are different
   */
  private tilesChanged(oldTiles: ITile[], newTiles: ITile[]): boolean {
    if (oldTiles.length !== newTiles.length) {
      return true;
    }

    const oldTileKeys = new Set(oldTiles.map(t => this.getTileKey(t)));
    const newTileKeys = new Set(newTiles.map(t => this.getTileKey(t)));

    for (const key of newTileKeys) {
      if (!oldTileKeys.has(key)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate which tiles are visible in the current viewport
   */
  private calculateVisibleTiles(viewport: Viewport): ITile[] {
    const { tileSize = 512, minZoom = -10, maxZoom = 10 } = this.props;
    
    // Get viewport bounds in image coordinates
    const bounds = this.getViewportBounds(viewport);
    
    // Get the current zoom level directly from viewport
    const currentZoom = viewport.zoom;
    const zoom = Math.max(minZoom, Math.min(maxZoom, Math.round(currentZoom)));
    
    // Calculate the scale factor for this zoom level
    // At zoom 0: scale = 1 (full resolution)
    // At zoom -1: scale = 2 (half resolution, so coordinates are scaled up by 2)
    // At zoom -2: scale = 4 (quarter resolution, so coordinates are scaled up by 4)
    const scale = Math.pow(2, -zoom);
    
    // Convert viewport bounds to tile coordinates at this zoom level
    // At each zoom level, tiles are still tileSize x tileSize pixels,
    // but they represent different amounts of the original image
    const minTileX = Math.floor(bounds.left / (tileSize * scale));
    const maxTileX = Math.floor(bounds.right / (tileSize * scale));
    const minTileY = Math.floor(bounds.top / (tileSize * scale));
    const maxTileY = Math.floor(bounds.bottom / (tileSize * scale));
    
    this.debugLog('Calculating visible tiles', {
      zoom,
      scale,
      tileSize,
      viewportBounds: bounds,
      tileBounds: [minTileX, minTileY, maxTileX, maxTileY]
    });

    const tiles: ITile[] = [];
    
    // Generate tiles for the calculated range
    for (let x = minTileX; x <= maxTileX; x++) {
      for (let y = minTileY; y <= maxTileY; y++) {
        // Skip negative tile coordinates
        if (x < 0 || y < 0) continue;
        
        // Calculate tile bounds in original image coordinates
        // Each tile at this zoom level covers (tileSize * scale) pixels of the original image
        const tile: ITile = {
          x,
          y,
          z: zoom,
          left: x * tileSize * scale,
          top: y * tileSize * scale,
          right: (x + 1) * tileSize * scale,
          bottom: (y + 1) * tileSize * scale
        };
        
        tiles.push(tile);
      }
    }
    
    this.debugLog(`Found ${tiles.length} visible tiles`, {
      tileRange: { minTileX, maxTileX, minTileY, maxTileY },
      tiles: tiles.map(t => `${t.x},${t.y},${t.z}`),
      tileBounds: tiles.length > 0 ? {
        first: { left: tiles[0].left, top: tiles[0].top, right: tiles[0].right, bottom: tiles[0].bottom },
        last: tiles.length > 1 ? { 
          left: tiles[tiles.length-1].left, 
          top: tiles[tiles.length-1].top, 
          right: tiles[tiles.length-1].right, 
          bottom: tiles[tiles.length-1].bottom 
        } : null
      } : null
    });
    
    return tiles;
  }

  /**
   * Get viewport bounds in image coordinates
   */
  private getViewportBounds(viewport: Viewport): { left: number; top: number; right: number; bottom: number } {
    // Get the viewport dimensions
    const { width, height } = viewport;
    
    // Access viewport properties directly
    const centerX = viewport.center[0];
    const centerY = viewport.center[1];
    const zoom = viewport.zoom;
    
    // Calculate the visible area size based on zoom
    // Use consistent scaling with tile calculations: scale = 2^(-zoom)
    // At zoom 0: scale = 1, visible area = viewport size
    // At zoom -1: scale = 2, visible area = 2x viewport size (zoomed out)
    // At zoom 1: scale = 0.5, visible area = 0.5x viewport size (zoomed in)
    const scale = Math.pow(2, -zoom);
    const visibleWidth = width * scale;
    const visibleHeight = height * scale;
    
    const bounds = {
      left: centerX - visibleWidth / 2,
      right: centerX + visibleWidth / 2,
      top: centerY - visibleHeight / 2,
      bottom: centerY + visibleHeight / 2
    };
    
    this.debugLog('Viewport bounds calculated', {
      viewCenter: [centerX, centerY],
      viewSize: [width, height],
      viewZoom: zoom,
      scale,
      visibleSize: [visibleWidth, visibleHeight],
      bounds
    });
    
    return bounds;
  }

  /**
   * Get tile key for caching
   */
  private getTileKey(tile: ITile): string {
    return `${tile.x}-${tile.y}-${tile.z}`;
  }

  /**
   * Load tile data from the backend
   */
  private async loadTileData(tile: ITile): Promise<void> {
    const tileKey = this.getTileKey(tile);
    
    // Check if already loading
    if (this.loadingTiles.has(tileKey)) {
      return;
    }
    
    // Check cache
    const cachedTile = this.tileCache.get(tileKey);
    if (cachedTile?.data) {
      tile.data = cachedTile.data;
      return;
    }
    
    this.loadingTiles.add(tileKey);
    tile.loading = true;
    
    this.debugLog(`Loading tile ${tileKey}`, tile);
    
    try {
      const tileData = await new Promise<string>((resolve, reject) => {
        const commFuture = this.props.comm.send({
          type: 'IMAGE_TILE_REQUEST',
          dataset: this.props.imageName,
          zoom: tile.z,
          row: tile.y,
          col: tile.x
        });

        // Set timeout
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout loading tile ${tileKey}`));
        }, 10000);

        commFuture.onIOPub = (msg: any): void => {
          const msgType = msg.header.msg_type;
          if (msgType === 'comm_msg') {
            const base64Data = msg.content.data.img;
            const dataUrl = `data:image/png;base64,${base64Data}`;
            
            clearTimeout(timeoutId);
            resolve(dataUrl);
          }
        };

        commFuture.done.catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
      });

      // Update tile with data
      tile.data = tileData;
      tile.loading = false;
      tile.error = false;
      
      // Cache the tile
      this.tileCache.set(tileKey, { ...tile });
      
      this.debugLog(`Successfully loaded tile ${tileKey}`);
      
      // Trigger re-render
      this.setNeedsRedraw();
      
    } catch (error) {
      console.error(`Error loading tile ${tileKey}:`, error);
      tile.loading = false;
      tile.error = true;
      this.debugLog(`Failed to load tile ${tileKey}`, error);
    } finally {
      this.loadingTiles.delete(tileKey);
    }
  }

  /**
   * Load tile data using the configured getTileData function
   */
  private async loadTileDataWithFunction(tile: ITile): Promise<void> {
    const tileKey = this.getTileKey(tile);
    
    // Check if already loading
    if (this.loadingTiles.has(tileKey)) {
      return;
    }
    
    // Check cache
    const cachedTile = this.tileCache.get(tileKey);
    if (cachedTile?.data) {
      tile.data = cachedTile.data;
      return;
    }
    
    // Use the configured getTileData function if available
    if (!this.props.getTileData) {
      this.debugLog(`No getTileData function provided for tile ${tileKey}`);
      return;
    }
    
    this.loadingTiles.add(tileKey);
    tile.loading = true;
    
    this.debugLog(`Loading tile ${tileKey} with getTileData function`, tile);
    
    try {
      const tileData = await this.props.getTileData(tile);
      
      if (tileData) {
        // Update tile with data
        tile.data = tileData;
        tile.loading = false;
        tile.error = false;
        
        // Cache the tile
        this.tileCache.set(tileKey, { ...tile });
        
        this.debugLog(`Successfully loaded tile ${tileKey}`);
        
        // Trigger re-render by marking the layer as needing redraw
        this.setNeedsRedraw();
        
        // Force the layer to update by invalidating the current state
        // This will cause Deck.gl to call renderLayers again
        this.setState({});
      } else {
        tile.loading = false;
        tile.error = true;
        this.debugLog(`getTileData returned null for tile ${tileKey}`);
      }
      
    } catch (error) {
      console.error(`Error loading tile ${tileKey}:`, error);
      tile.loading = false;
      tile.error = true;
      this.debugLog(`Failed to load tile ${tileKey}`, error);
    } finally {
      this.loadingTiles.delete(tileKey);
    }
  }

  /**
   * Render sublayers for visible tiles
   */
  renderLayers(): Layer[] {
    // Use the cached visible tiles from updateState() instead of recalculating
    const visibleTiles = this.currentVisibleTiles;
    const layers: Layer[] = [];

    this.debugLog(`renderLayers: processing ${visibleTiles.length} visible tiles`);

    // Process each visible tile
    for (const tile of visibleTiles) {
      const tileKey = this.getTileKey(tile);
      
      // Check if we have cached data for this tile
      const cachedTile = this.tileCache.get(tileKey);
      if (cachedTile?.data) {
        tile.data = cachedTile.data;
      }
      
      // Start loading tile data if not already loaded/loading
      if (!tile.data && !tile.loading && !tile.error) {
        // Use the configured getTileData function
        this.loadTileDataWithFunction(tile);
      }

      // Create bitmap layer for this tile if we have data
      if (tile.data) {
        const bitmapLayer = new BitmapLayer({
          id: `tile-${tileKey}`,
          image: tile.data,
          bounds: [tile.left, tile.bottom, tile.right, tile.top],
          opacity: this.props.opacity,
          visible: this.props.visible
        } as any); // Type assertion to work around BitmapLayer typing issues
        
        layers.push(bitmapLayer);
      }
    }

    this.debugLog(`Rendered ${layers.length} tile layers from ${visibleTiles.length} visible tiles`);
    return layers;
  }

  /**
   * Clear the tile cache
   */
  public clearCache(): void {
    const cacheSize = this.tileCache.size;
    this.tileCache.clear();
    this.loadingTiles.clear();
    this.debugLog(`Cleared cache (${cacheSize} tiles)`);
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; loading: number } {
    return {
      size: this.tileCache.size,
      loading: this.loadingTiles.size
    };
  }
}

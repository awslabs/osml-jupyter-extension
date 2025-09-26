import { GeoJsonLayer } from '@deck.gl/layers';
import { Kernel } from '@jupyterlab/services';
import { IDeckImageLayerOptions } from './IDeckImageLayerOptions';
import { Feature, FeatureCollection } from 'geojson';

/**
 * Factory function for creating a Deck.gl GeoJsonLayer that renders vector overlays from a Jupyter Kernel.
 * This replaces the Leaflet-based JupyterOverlayLayer with a WebGL-based implementation.
 */
export function createDeckJupyterOverlayLayer(
  comm: Kernel.IComm | undefined,
  imageName: string,
  overlayName: string,
  options: IDeckImageLayerOptions = {}
): GeoJsonLayer {
  if (!comm) {
    console.warn('No comm channel available for overlay layer');
    return new GeoJsonLayer({
      id: `jupyter-overlay-layer-${overlayName}`,
      data: { type: 'FeatureCollection', features: [] }
    });
  }

  const featureCache = new Map<string, FeatureCollection>();

  /**
   * Fetches feature data from the Jupyter kernel via comm channel.
   * Returns a Promise that resolves to GeoJSON FeatureCollection.
   * Note: This function is currently unused but kept for future tiled vector implementation.
   */
  // @ts-ignore: Function kept for future implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getFeatureData = async (tile: any): Promise<FeatureCollection> => {
    const { x, y, z } = tile.index;
    const tileKey = `${x}-${y}-${z}`;
    
    // Check cache first
    if (featureCache.has(tileKey)) {
      return featureCache.get(tileKey)!;
    }

    console.log(`Fetching overlay for: ${overlayName} (x,y,z) = (${x},${y},${z})`);

    try {
      const featureData = await new Promise<Feature[]>((resolve, reject) => {
        const commFuture = comm.send({
          type: 'OVERLAY_TILE_REQUEST',
          imageName: imageName,
          overlayName: overlayName,
          zoom: z,
          row: y,
          col: x
        });

        // Set a timeout to reject the promise if we don't get a response
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout waiting for overlay response'));
        }, 10000); // 10 second timeout

        commFuture.onIOPub = (msg: any): void => {
          const msgType = msg.header.msg_type;
          if (msgType === 'comm_msg') {
            console.log(
              `Received overlay tile from comm containing ${msg.content?.data?.features?.length || 0} features.`
            );
            clearTimeout(timeoutId);
            resolve(msg.content.data.features || []);
          }
        };

        // Handle comm future done with error
        commFuture.done.catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
      });

      // Convert features to use imageGeometry if available
      const processedFeatures = featureData.map((feature: Feature) => {
        if (feature.properties?.imageGeometry) {
          // Use imageGeometry as the main geometry for rendering
          return {
            ...feature,
            geometry: feature.properties.imageGeometry
          };
        }
        return feature;
      });

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: processedFeatures
      };

      // Cache the feature data
      featureCache.set(tileKey, featureCollection);
      return featureCollection;
    } catch (error) {
      console.error(`Error fetching overlay tile ${tileKey}:`, error);
      return { type: 'FeatureCollection', features: [] };
    }
  };

  // For now, we'll create a simple GeoJsonLayer
  // In a full implementation, we might need to create a custom layer that handles tiled vector data
  return new GeoJsonLayer({
    id: `jupyter-overlay-layer-${overlayName}`,
    data: { type: 'FeatureCollection', features: [] }, // Start with empty data
    opacity: options.opacity || 0.8,
    visible: options.visible !== false,
    
    // Styling to match the original FeatureRenderer
    getFillColor: [255, 0, 0, 47], // #FF00002F (red with alpha)
    getLineColor: [255, 0, 0, 255], // #FF0000FF (solid red)
    getLineWidth: 1,
    getPointRadius: 20,
    
    // Enable picking for interactivity
    pickable: true,
    
    // Line and fill properties
    filled: true,
    stroked: true,
    lineWidthMinPixels: 1,
    
    // Point properties
    pointRadiusMinPixels: 1,
    pointRadiusMaxPixels: 100
  });
}

/**
 * Utility class for managing Deck.gl-based Jupyter overlay layers.
 * Provides methods for loading vector data and managing layer state.
 */
export class DeckJupyterOverlayLayerManager {
  private featureCache: Map<string, FeatureCollection> = new Map();
  private layer: GeoJsonLayer | null = null;
  private allFeatures: Feature[] = [];

  constructor(
    private comm: Kernel.IComm | undefined,
    private imageName: string,
    private overlayName: string,
    private options: IDeckImageLayerOptions = {}
  ) {}

  /**
   * Create and return the Deck.gl layer with current data.
   */
  public getLayer(): GeoJsonLayer {
    // Always create a new layer with current data since Deck.gl layers are immutable
    this.layer = new GeoJsonLayer({
      id: `jupyter-overlay-layer-${this.overlayName}`,
      data: {
        type: 'FeatureCollection',
        features: this.allFeatures
      },
      opacity: this.options.opacity || 0.8,
      visible: this.options.visible !== false,
      
      // Styling to match the original FeatureRenderer
      getFillColor: [255, 0, 0, 47], // #FF00002F (red with alpha)
      getLineColor: [255, 0, 0, 255], // #FF0000FF (solid red)
      getLineWidth: 1,
      getPointRadius: 20,
      
      // Enable picking for interactivity
      pickable: true,
      
      // Line and fill properties
      filled: true,
      stroked: true,
      lineWidthMinPixels: 1,
      
      // Point properties
      pointRadiusMinPixels: 1,
      pointRadiusMaxPixels: 100
    });
    
    return this.layer;
  }

  /**
   * Load features for a specific tile and update the layer.
   */
  public async loadTileFeatures(x: number, y: number, z: number): Promise<void> {
    if (!this.comm) {
      return;
    }

    const tileKey = `${x}-${y}-${z}`;
    
    // Check cache first
    if (this.featureCache.has(tileKey)) {
      return;
    }

    console.log(`Loading overlay features for: ${this.overlayName} (x,y,z) = (${x},${y},${z})`);

    try {
      const featureData = await new Promise<Feature[]>((resolve, reject) => {
        const commFuture = this.comm!.send({
          type: 'OVERLAY_TILE_REQUEST',
          imageName: this.imageName,
          overlayName: this.overlayName,
          zoom: z,
          row: y,
          col: x
        });

        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout waiting for overlay response'));
        }, 10000);

        commFuture.onIOPub = (msg: any): void => {
          const msgType = msg.header.msg_type;
          if (msgType === 'comm_msg') {
            console.log(
              `Received overlay tile containing ${msg.content?.data?.features?.length || 0} features.`
            );
            clearTimeout(timeoutId);
            resolve(msg.content.data.features || []);
          }
        };

        commFuture.done.catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
      });

      // Process features to use imageGeometry
      const processedFeatures = featureData.map((feature: Feature) => {
        if (feature.properties?.imageGeometry) {
          return {
            ...feature,
            geometry: feature.properties.imageGeometry
          };
        }
        return feature;
      });

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: processedFeatures
      };

      // Cache and add to all features
      this.featureCache.set(tileKey, featureCollection);
      this.allFeatures.push(...processedFeatures);

      // Note: Deck.gl layers are immutable, so we need to recreate the layer
      // with new data. This will be handled by the parent component.
    } catch (error) {
      console.error(`Error loading overlay tile ${tileKey}:`, error);
    }
  }

  /**
   * Clear the feature cache and reset layer data.
   */
  public clearCache(): void {
    this.featureCache.clear();
    this.allFeatures = [];
    // Force recreation of layer with empty data
    this.layer = null;
  }

  /**
   * Get cache size for debugging.
   */
  public getCacheSize(): number {
    return this.featureCache.size;
  }

  /**
   * Update layer options.
   */
  public updateOptions(newOptions: Partial<IDeckImageLayerOptions>): void {
    this.options = { ...this.options, ...newOptions };
    // Force recreation of layer with new options
    this.layer = null;
  }

  /**
   * Get all loaded features.
   */
  public getAllFeatures(): Feature[] {
    return [...this.allFeatures];
  }
}

// Copyright Amazon.com, Inc. or its affiliates.

import { Signal } from '@lumino/signaling';
import { TiledOverlayLayer } from '../layers';
import { ILayerInfo, FeatureTileDataFunction } from '../types';

/**
 * LayerManager handles all layer-related operations including visibility,
 * color management, and layer lifecycle for the ImageViewerWidget
 */
export class LayerManager {
  private featureLayers: Map<string, TiledOverlayLayer> = new Map();
  private modelLayers: Map<string, TiledOverlayLayer> = new Map();
  private layerVisibility: Map<string, boolean> = new Map();
  private layerColors: Map<string, [number, number, number, number]> =
    new Map();

  // Signals for layer changes
  private _layersChanged = new Signal<LayerManager, void>(this);

  constructor(private enableDebugLogging: boolean = false) {}

  /**
   * Signal emitted when layers change (add, remove, visibility, color)
   */
  get layersChanged(): Signal<LayerManager, void> {
    return this._layersChanged;
  }

  /**
   * Debug logging utility
   */
  private debugLog(message: string, data?: any): void {
    if (this.enableDebugLogging) {
      console.log(`[LayerManager] ${message}`, data || '');
    }
  }

  /**
   * Create a feature layer for overlay data using TiledOverlayLayer
   */
  private createFeatureLayer(
    overlayName: string,
    getTileData: FeatureTileDataFunction
  ): TiledOverlayLayer {
    // Get current colors from state
    const customColor = this.layerColors.get(overlayName) ?? [255, 0, 0, 128];
    const lineColor = customColor;

    console.log(`[LayerManager] Creating TiledOverlayLayer for ${overlayName}`);
    return new TiledOverlayLayer({
      id: `features-${overlayName}`,
      data: [], // Required by TileLayer but not used since we provide getTileData
      getTileData, // This is our custom FeatureTileDataFunction
      tileSize: 512,
      minZoom: -10,
      maxZoom: 10,
      maxCacheSize: 100,
      maxCacheByteSize: 50 * 1024 * 1024, // 50MB cache
      debounceTime: 100,
      // Culling options
      maxFeaturesPerTile: 10000,
      minFeatureAreaPixels: 1.0,
      minFeatureSizePixels: 0.5,
      // LOD options
      simplificationTolerance: 0.5,
      clusterDistance: 20,
      lodZoomThresholds: [-3, 0, 3],
      // Rendering options
      featureFillColor: lineColor, // Use full color for features
      featureLineColor: lineColor,
      featureLineWidth: 1,
      adaptivePointSize: true,
      enableDebugLogging: true || this.enableDebugLogging
    } as any); // Type assertion to bypass the prop type conflict
  }

  /**
   * Add a feature layer
   */
  public addFeatureLayer(
    layerId: string,
    getTileData: FeatureTileDataFunction
  ): void {
    this.debugLog(`Adding feature layer: ${layerId}`);

    // Create the feature layer using TiledOverlayLayer
    const featureLayer = this.createFeatureLayer(layerId, getTileData);

    // Store the feature layer
    this.featureLayers.set(layerId, featureLayer);

    // Emit layers changed signal
    this._layersChanged.emit();
  }

  /**
   * Add a model feature layer
   */
  public addModelFeatureLayer(
    modelName: string,
    getTileData: FeatureTileDataFunction
  ): void {
    this.debugLog(`Adding model feature layer: ${modelName}`);

    // Remove existing model layer if present (only one model at a time)
    this.clearModelLayers();

    // Create the model feature layer using TiledOverlayLayer
    const modelFeatureLayer = this.createFeatureLayer(modelName, getTileData);

    // Store the model layer
    this.modelLayers.set(modelName, modelFeatureLayer);

    // Emit layers changed signal
    this._layersChanged.emit();
  }

  /**
   * Set layer visibility
   */
  public setLayerVisibility(layerId: string, visible: boolean): void {
    this.layerVisibility.set(layerId, visible);
    this.debugLog(`Layer ${layerId} visibility set to ${visible}`);

    // Emit layers changed signal
    this._layersChanged.emit();
  }

  /**
   * Set layer color
   */
  public setLayerColor(
    layerId: string,
    color: [number, number, number, number]
  ): void {
    this.layerColors.set(layerId, color);
    this.debugLog(`Layer ${layerId} color updated`, color);

    // Recreate the specific layer with new color
    if (this.featureLayers.has(layerId)) {
      const layer = this.featureLayers.get(layerId);
      if (layer) {
        // Get the existing getTileData function
        const existingLayer = layer as any;
        const getTileData = existingLayer.props.getTileData;

        // Create new layer with updated color
        const newLayer = this.createFeatureLayer(layerId, getTileData);

        // Replace the layer
        this.featureLayers.set(layerId, newLayer);
      }
    }

    if (this.modelLayers.has(layerId)) {
      const layer = this.modelLayers.get(layerId);
      if (layer) {
        // For model layers, we need to recreate using the existing pattern
        const existingLayer = layer as any;
        const getTileData = existingLayer.props.getTileData;

        // Create new model layer with updated color using TiledOverlayLayer
        const newModelLayer = this.createFeatureLayer(layerId, getTileData);

        // Replace the layer
        this.modelLayers.set(layerId, newModelLayer);
      }
    }

    // Emit layers changed signal
    this._layersChanged.emit();
  }

  /**
   * Delete a layer
   */
  public deleteLayer(layerId: string): void {
    this.debugLog(`Deleting layer: ${layerId}`);

    // Remove from feature layers
    if (this.featureLayers.has(layerId)) {
      const layer = this.featureLayers.get(layerId);
      if (layer) {
        layer.clearCache();
      }
      this.featureLayers.delete(layerId);
    }

    // Remove from model layers
    if (this.modelLayers.has(layerId)) {
      const layer = this.modelLayers.get(layerId);
      if (layer) {
        layer.clearCache();
      }
      this.modelLayers.delete(layerId);
    }

    // Clean up layer state
    this.layerVisibility.delete(layerId);
    this.layerColors.delete(layerId);

    // Emit layers changed signal
    this._layersChanged.emit();
  }

  /**
   * Clear all model feature layers
   */
  public clearModelLayers(): void {
    if (this.modelLayers.size > 0) {
      this.debugLog('Clearing model layers');

      // Clear caches and dispose of layers
      for (const modelLayer of this.modelLayers.values()) {
        modelLayer.clearCache();
      }
      this.modelLayers.clear();

      // Emit layers changed signal
      this._layersChanged.emit();
    }
  }

  /**
   * Get layer information for the layer control dialog
   */
  public getLayerInfo(): ILayerInfo[] {
    const layers: ILayerInfo[] = [];

    // Add feature layers
    for (const [layerId] of this.featureLayers.entries()) {
      layers.push({
        id: layerId,
        name: layerId,
        visible: this.layerVisibility.get(layerId) ?? true,
        color: this.layerColors.get(layerId) ?? [255, 0, 0, 128],
        type: 'feature'
      });
    }

    // Add model layers
    for (const [layerId] of this.modelLayers.entries()) {
      layers.push({
        id: layerId,
        name: layerId,
        visible: this.layerVisibility.get(layerId) ?? true,
        color: this.layerColors.get(layerId) ?? [255, 0, 0, 128],
        type: 'model'
      });
    }

    return layers;
  }

  /**
   * Get all layers (feature + model layers) that are visible
   */
  public getAllVisibleLayers(): TiledOverlayLayer[] {
    const visibleLayers: TiledOverlayLayer[] = [];

    // Add visible feature layers
    for (const [layerId, layer] of this.featureLayers.entries()) {
      const visible = this.layerVisibility.get(layerId) ?? true;
      if (visible) {
        visibleLayers.push(layer);
      }
    }

    // Add visible model layers
    for (const [layerId, layer] of this.modelLayers.entries()) {
      const visible = this.layerVisibility.get(layerId) ?? true;
      if (visible) {
        visibleLayers.push(layer);
      }
    }

    return visibleLayers;
  }

  /**
   * Check if a layer exists
   */
  public hasLayer(layerId: string): boolean {
    return this.featureLayers.has(layerId) || this.modelLayers.has(layerId);
  }

  /**
   * Get layer count
   */
  public getLayerCount(): number {
    return this.featureLayers.size + this.modelLayers.size;
  }

  /**
   * Dispose of all layers and clean up resources
   */
  public dispose(): void {
    this.debugLog('Disposing LayerManager');

    // Clear feature layers
    for (const featureLayer of this.featureLayers.values()) {
      featureLayer.clearCache();
    }
    this.featureLayers.clear();

    // Clear model layers
    for (const modelLayer of this.modelLayers.values()) {
      modelLayer.clearCache();
    }
    this.modelLayers.clear();

    // Clear state maps
    this.layerVisibility.clear();
    this.layerColors.clear();

    // Clear signals
    Signal.clearData(this);
  }

  /**
   * Enable/disable debug logging
   */
  public setDebugLogging(enabled: boolean): void {
    this.enableDebugLogging = enabled;
  }
}

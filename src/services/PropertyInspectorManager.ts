// Copyright Amazon.com, Inc. or its affiliates.

import {
  IPropertyInspector,
  IPropertyInspectorProvider
} from '@jupyterlab/property-inspector';
import * as React from 'react';
import { ImageViewerPropertyInspector } from '../components';
import {
  ISelectionChangedArgs,
  IImageInfo,
  ICurrentSelection,
  ILayerControlActions
} from '../types';
import { LayerManager, FeatureTileService } from './index';
import { logger } from '../utils';

/**
 * Manages property inspector integration for ImageViewerWidget through signals
 */
export class PropertyInspectorManager {
  private propertyInspector?: IPropertyInspector;
  private currentSelection: ICurrentSelection = { type: null };
  private imageInfo: IImageInfo = {};
  private layerManager?: LayerManager;
  private featureTileService?: FeatureTileService;
  private getCurrentImageName?: () => string | undefined;

  /**
   * Set layer dependencies needed for layer control functionality
   */
  public setLayerDependencies(
    layerManager: LayerManager,
    featureTileService: FeatureTileService,
    getCurrentImageName: () => string | undefined
  ): void {
    this.layerManager = layerManager;
    this.featureTileService = featureTileService;
    this.getCurrentImageName = getCurrentImageName;

    // Connect to layer changes to update property inspector
    if (this.layerManager) {
      this.layerManager.layersChanged.connect(() => {
        this.updatePropertyInspectorContent();
      });
    }
  }

  /**
   * Register with the property inspector provider
   */
  public register(provider: IPropertyInspectorProvider, owner: any): boolean {
    if (this.propertyInspector) {
      // Already registered
      return true;
    }

    try {
      this.propertyInspector = provider.register(owner);
      this.updatePropertyInspectorContent();
      logger.info(
        'PropertyInspectorManager: Successfully registered with property inspector'
      );
      return true;
    } catch (error: any) {
      logger.error(
        `PropertyInspectorManager: Failed to register with property inspector: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Handle selection changed signal
   */
  public onSelectionChanged(sender: any, args: ISelectionChangedArgs): void {
    this.currentSelection = {
      type: args.type,
      data: args.data,
      imageCoordinates: args.imageCoordinates,
      worldCoordinates: args.worldCoordinates,
      coordinateError: args.coordinateError,
      isLoadingCoordinates: args.isLoadingCoordinates
    };

    this.updatePropertyInspectorContent();
  }

  /**
   * Handle selection cleared signal
   */
  public onSelectionCleared(sender: any): void {
    this.currentSelection = { type: null };
    this.updatePropertyInspectorContent();
  }

  /**
   * Handle image info changed signal
   */
  public onImageInfoChanged(sender: any, imageInfo: IImageInfo): void {
    this.imageInfo = { ...imageInfo };
    this.updatePropertyInspectorContent();
  }

  /**
   * Create layer actions object
   */
  private createLayerActions(): ILayerControlActions {
    return {
      toggleVisibility: (layerId: string) => {
        if (!this.layerManager) {
          return;
        }

        const currentLayers = this.layerManager.getLayerInfo();
        const layer = currentLayers.find(l => l.id === layerId);
        const newVisibility = layer ? !layer.visible : true;
        this.layerManager.setLayerVisibility(layerId, newVisibility);
      },
      updateColor: (
        layerId: string,
        color: [number, number, number, number]
      ) => {
        if (!this.layerManager) {
          return;
        }
        this.layerManager.setLayerColor(layerId, color);
      },
      deleteLayer: (layerId: string) => {
        if (!this.layerManager) {
          return;
        }
        this.layerManager.deleteLayer(layerId);
      },
      addNamedDataset: (datasetName: string) => {
        if (
          !this.layerManager ||
          !this.featureTileService ||
          !this.getCurrentImageName
        ) {
          return;
        }

        const imageName = this.getCurrentImageName();
        if (!datasetName || !imageName) {
          console.warn('Cannot add named dataset: Missing required parameters');
          return;
        }

        const getFeatureTileData =
          this.featureTileService.createFeatureDataFunction(
            imageName,
            datasetName
          );
        this.layerManager.addFeatureLayer(datasetName, getFeatureTileData);
      }
    };
  }

  /**
   * Update the property inspector content
   */
  private updatePropertyInspectorContent(): void {
    if (!this.propertyInspector) {
      return;
    }

    // Get current layers or empty array if layerManager not available
    const layers = this.layerManager ? this.layerManager.getLayerInfo() : [];
    const layerActions = this.createLayerActions();

    const content = React.createElement(ImageViewerPropertyInspector, {
      currentSelection: this.currentSelection,
      imageInfo: this.imageInfo,
      layers: layers,
      layerActions: layerActions
    });

    this.propertyInspector.render(content);
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.propertyInspector = undefined;
    this.currentSelection = { type: null };
    this.imageInfo = {};
  }
}

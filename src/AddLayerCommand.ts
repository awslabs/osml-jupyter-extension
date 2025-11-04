// Copyright Amazon.com, Inc. or its affiliates.

import { AbstractCommand } from './AbstractCommand';
import { Contents } from '@jupyterlab/services';
import { logger } from './utils';

/**
 * Command class for adding layers to the OversightML viewer
 */
export class AddLayerCommand extends AbstractCommand {
  protected async executeCommandLogic(
    selectedFileName: string | null
  ): Promise<void> {
    if (!this.sharedState.widget || !this.sharedState.serviceContainer) {
      throw new Error('Widget not initialized');
    }

    // Validate layer file selection
    if (!selectedFileName) {
      console.error('Layer addition failed - no layer file selected');
      return;
    }

    // Get services from container
    const services = this.sharedState.serviceContainer.getServices();
    const { layerManager, featureTileService, imageManager } = services;

    // Validate that an image is loaded
    const currentImage = imageManager.getCurrentImage();
    if (!currentImage) {
      const errorMessage =
        'Error: No image loaded. Please open an image first before adding layers.';
      this.sharedState.widget.statusSignal.emit(errorMessage);
      logger.error('Layer addition failed - no image loaded');
      return;
    }

    try {
      this.sharedState.widget.statusSignal.emit(
        `Loading overlay from ${selectedFileName}...`
      );

      const loadResponse = await featureTileService.loadOverlay(
        currentImage.name,
        selectedFileName
      );

      // Check if the overlay load was successful
      if (!loadResponse.success) {
        const errorMessage = `Error: ${selectedFileName} could not be loaded as an overlay layer${loadResponse.error ? ` - ${loadResponse.error}` : ''}`;
        this.sharedState.widget.statusSignal.emit(errorMessage);
        logger.error(
          `Failed to load overlay ${selectedFileName}: ${loadResponse.error || 'Unknown error'}`
        );
        return;
      }

      this.sharedState.widget.statusSignal.emit(
        `Loading overlay from ${selectedFileName}... ${loadResponse.status}`
      );

      // Create feature tile data function
      const getFeatureTileData = featureTileService.createFeatureDataFunction(
        currentImage.name,
        selectedFileName
      );

      // Add the feature layer via LayerManager - signal will automatically update deck layers
      layerManager.addFeatureLayer(selectedFileName, getFeatureTileData);

      this.sharedState.widget.statusSignal.emit(
        `Added overlay layer: ${selectedFileName}`
      );
      logger.info(`Layer added successfully: ${selectedFileName}`);
    } catch (error: any) {
      logger.error(`Failed to add layer ${selectedFileName}: ${error.message}`);
      console.error('Error loading overlay:', error);
      this.sharedState.widget.statusSignal.emit(
        `Error loading overlay ${selectedFileName}: ${error.message}`
      );
      return;
    }
  }

  /**
   * Check if this command should be visible based on selected files
   * Only show for GeoJSON files with extension: .geojson
   */
  protected checkVisibility(selectedFiles: Contents.IModel[]): boolean {
    if (selectedFiles.length === 0) {
      return false;
    }

    return selectedFiles.some(file => {
      const fileName = file.name.toLowerCase();
      return fileName.endsWith('.geojson');
    });
  }
}

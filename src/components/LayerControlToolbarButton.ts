// Copyright Amazon.com, Inc. or its affiliates.

import { ToolbarButton } from '@jupyterlab/apputils';
import { LayerManager, FeatureTileService } from '../services';
import { listIcon } from '../utils/icons';
import LayerControlDialog from './LayerControlDialog';

/**
 * A toolbar button widget for controlling overlay layers
 */
export class LayerControlToolbarButton extends ToolbarButton {
  constructor(
    private _layerManager: LayerManager,
    private _featureTileService: FeatureTileService,
    private _getCurrentImageName: () => string | undefined
  ) {
    super({
      icon: listIcon,
      onClick: () => this._handleClick(),
      tooltip: 'Manage overlay layers'
    });
  }

  /**
   * Handle button click - show layer control dialog
   */
  private async _handleClick(): Promise<void> {
    try {
      // Get fresh layer information from LayerManager
      const layers = this._layerManager.getLayerInfo();

      // Create the dialog content with close handler
      const dialogContent: LayerControlDialog = new LayerControlDialog(
        layers,
        {
          toggleVisibility: (layerId: string) =>
            this._toggleLayerVisibility(layerId, dialogContent),
          updateColor: (
            layerId: string,
            color: [number, number, number, number]
          ) => this._updateLayerColor(layerId, color, dialogContent),
          deleteLayer: (layerId: string) =>
            this._deleteLayer(layerId, dialogContent),
          addNamedDataset: (datasetName: string) =>
            this._addNamedDataset(datasetName, dialogContent)
        },
        () => {
          // Close handler - remove dialog from DOM and dispose it
          if (dialogContent.node.parentNode) {
            dialogContent.node.parentNode.removeChild(dialogContent.node);
          }
          dialogContent.dispose();
        }
      );

      // Set up signal connection to update dialog when layers change
      this._layerManager.layersChanged.connect(() => {
        const updatedLayers = this._layerManager.getLayerInfo();
        dialogContent.updateLayers(updatedLayers);
      });

      // Add dialog to document body to show as overlay
      document.body.appendChild(dialogContent.node);

      // Force the widget to render
      dialogContent.update();
    } catch (error) {
      console.error('Error showing layer control dialog:', error);
    }
  }

  /**
   * Toggle layer visibility
   */
  private _toggleLayerVisibility(
    layerId: string,
    dialog?: LayerControlDialog
  ): void {
    try {
      // Get current visibility state from LayerManager
      const currentLayers = this._layerManager.getLayerInfo();
      const layer = currentLayers.find(l => l.id === layerId);
      const newVisibility = layer ? !layer.visible : true;

      // Call LayerManager method directly - this will emit signal to update UI
      this._layerManager.setLayerVisibility(layerId, newVisibility);
    } catch (error) {
      console.error('Error toggling layer visibility:', error);
    }
  }

  /**
   * Update layer color
   */
  private _updateLayerColor(
    layerId: string,
    color: [number, number, number, number],
    dialog?: LayerControlDialog
  ): void {
    try {
      // Call LayerManager method directly - this will emit signal to update UI
      this._layerManager.setLayerColor(layerId, color);
    } catch (error) {
      console.error('Error updating layer color:', error);
    }
  }

  /**
   * Delete layer
   */
  private _deleteLayer(layerId: string, dialog?: LayerControlDialog): void {
    try {
      // Call LayerManager method directly - this will emit signal to update UI
      this._layerManager.deleteLayer(layerId);
    } catch (error) {
      console.error('Error deleting layer:', error);
    }
  }

  /**
   * Add named dataset as layer
   */
  private _addNamedDataset(
    datasetName: string,
    dialog?: LayerControlDialog
  ): void {
    try {
      // Get current image name from the injected function
      const imageName = this._getCurrentImageName();

      console.log(
        `LayerControlToolbarButton._addNamedDataset for ${imageName}:${datasetName}`
      );

      if (!datasetName || !imageName || !this._featureTileService) {
        console.warn('Cannot add named dataset: Missing required parameters', {
          datasetName: !!datasetName,
          imageName: !!imageName,
          featureTileService: !!this._featureTileService
        });
        return;
      }

      // Create feature tile data function
      const getFeatureTileData =
        this._featureTileService.createFeatureDataFunction(
          imageName,
          datasetName
        );

      // Add the feature layer via LayerManager - this will emit signal to update UI
      this._layerManager.addFeatureLayer(datasetName, getFeatureTileData);
    } catch (error) {
      console.error('Error adding named dataset:', error);
    }
  }

  /**
   * Update button state when layers change
   */
  public onLayersChanged(): void {
    // Button is always enabled for layer control
  }

  /**
   * Set button enabled/disabled state - kept for backward compatibility
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

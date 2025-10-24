// Copyright Amazon.com, Inc. or its affiliates.

import { ToolbarButton } from '@jupyterlab/apputils';
import { ImageViewerWidget } from '../ImageViewerWidget';
import { listIcon } from '../utils/icons';
import LayerControlDialog from './LayerControlDialog';
import { ILayerInfo } from '../types';

/**
 * A toolbar button widget for controlling overlay layers
 */
export class LayerControlToolbarButton extends ToolbarButton {
  constructor(private _imageViewerWidget: ImageViewerWidget) {
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
      // Get fresh layer information from the ImageViewerWidget
      const layers = this._getLayerInfo();

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

      // Add dialog to document body to show as overlay
      document.body.appendChild(dialogContent.node);

      // Force the widget to render
      dialogContent.update();
    } catch (error) {
      console.error('Error showing layer control dialog:', error);
    }
  }

  /**
   * Get layer information from the ImageViewerWidget
   */
  private _getLayerInfo(): ILayerInfo[] {
    // Use the ImageViewerWidget's getLayerInfo method to get actual layer state
    if (typeof (this._imageViewerWidget as any).getLayerInfo === 'function') {
      return (this._imageViewerWidget as any).getLayerInfo();
    }

    // Fallback to manual construction if method doesn't exist
    const layers: ILayerInfo[] = [];

    // Get feature layers
    const featureLayers = (this._imageViewerWidget as any).featureLayers;
    if (featureLayers && featureLayers instanceof Map) {
      for (const [layerId] of featureLayers.entries()) {
        layers.push({
          id: layerId,
          name: layerId,
          visible: true, // Default to visible for now
          color: [255, 0, 0, 128], // Default red color with alpha
          type: 'feature'
        });
      }
    }

    // Get model layers
    const modelLayers = (this._imageViewerWidget as any).modelLayers;
    if (modelLayers && modelLayers instanceof Map) {
      for (const [layerId] of modelLayers.entries()) {
        layers.push({
          id: layerId,
          name: layerId,
          visible: true, // Default to visible for now
          color: [255, 0, 0, 128], // Default red color with alpha
          type: 'model'
        });
      }
    }

    return layers;
  }

  /**
   * Toggle layer visibility
   */
  private _toggleLayerVisibility(
    layerId: string,
    dialog?: LayerControlDialog
  ): void {
    try {
      // Call method on ImageViewerWidget if it exists
      if (
        typeof (this._imageViewerWidget as any).setLayerVisibility ===
        'function'
      ) {
        const currentLayers = this._getLayerInfo();
        const layer = currentLayers.find(l => l.id === layerId);
        const newVisibility = layer ? !layer.visible : true;
        (this._imageViewerWidget as any).setLayerVisibility(
          layerId,
          newVisibility
        );
      } else {
        console.warn('setLayerVisibility method not implemented yet');
      }

      // Update the dialog with fresh layer data
      if (dialog) {
        const updatedLayers = this._getLayerInfo();
        dialog.updateLayers(updatedLayers);
      }
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
      // Call method on ImageViewerWidget if it exists
      if (
        typeof (this._imageViewerWidget as any).setLayerColor === 'function'
      ) {
        (this._imageViewerWidget as any).setLayerColor(layerId, color);
      } else {
        console.warn('setLayerColor method not implemented yet');
      }

      // Update the dialog with fresh layer data
      if (dialog) {
        const updatedLayers = this._getLayerInfo();
        dialog.updateLayers(updatedLayers);
      }
    } catch (error) {
      console.error('Error updating layer color:', error);
    }
  }

  /**
   * Delete layer
   */
  private _deleteLayer(layerId: string, dialog?: LayerControlDialog): void {
    try {
      // Call method on ImageViewerWidget if it exists
      if (typeof (this._imageViewerWidget as any).deleteLayer === 'function') {
        (this._imageViewerWidget as any).deleteLayer(layerId);
      } else {
        console.warn('deleteLayer method not implemented yet');
      }

      // Update the dialog with fresh layer data
      if (dialog) {
        const updatedLayers = this._getLayerInfo();
        dialog.updateLayers(updatedLayers);
      }
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
      // Call method on ImageViewerWidget if it exists
      if (
        typeof (this._imageViewerWidget as any).addNamedDataset === 'function'
      ) {
        (this._imageViewerWidget as any).addNamedDataset(datasetName);
      } else {
        console.warn('addNamedDataset method not implemented yet');
      }

      // Update the dialog with fresh layer data
      if (dialog) {
        const updatedLayers = this._getLayerInfo();
        dialog.updateLayers(updatedLayers);
      }
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

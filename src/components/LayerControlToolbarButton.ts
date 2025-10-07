import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { showDialog, Dialog } from '@jupyterlab/apputils';
import { ImageViewerWidget } from '../ImageViewerWidget';
import LayerControlDialog from './LayerControlDialog';
import { LayerInfo, LayerControlActions } from '../types';

/**
 * A toolbar button widget for controlling overlay layers
 */
export class LayerControlToolbarButton extends Widget {
  private _button: HTMLButtonElement;

  constructor(private _imageViewerWidget: ImageViewerWidget) {
    super();
    this.addClass('jp-ToolbarButton');
    this.addClass('jp-mod-styled');
    
    // Create the button element
    this._button = document.createElement('button');
    this._button.className = 'jp-ToolbarButtonComponent jp-Button jp-mod-minimal jp-LayerControlToolbarButton';
    this._button.title = 'Manage overlay layers';
    this._button.setAttribute('data-command', 'layer-control');
    
    // Create button content
    this._updateButtonContent();
    
    // Add click handler
    this._button.addEventListener('click', this._handleClick.bind(this));
    
    this.node.appendChild(this._button);
  }

  /**
   * Update the button content
   */
  private _updateButtonContent(): void {
    // Clear existing content
    this._button.innerHTML = '';
    
    // Create icon span (using layers/grid icon)
    const iconSpan = document.createElement('span');
    iconSpan.className = 'jp-ToolbarButtonComponent-icon';
    iconSpan.innerHTML = '🗂️'; // Using folder/layers emoji as icon
       
    this._button.appendChild(iconSpan);
  }

  /**
   * Handle button click - show layer control dialog
   */
  private async _handleClick(): Promise<void> {
    try {
      // Get fresh layer information from the ImageViewerWidget
      const layers = this._getLayerInfo();
      
      if (layers.length === 0) {
        console.log('No layers available - showing empty layer dialog');
      }

      // Create the dialog content
      const dialogContent: LayerControlDialog = new LayerControlDialog(layers, {
        toggleVisibility: (layerId: string) => this._toggleLayerVisibility(layerId, dialogContent),
        updateColor: (layerId: string, color: [number, number, number, number]) => 
          this._updateLayerColor(layerId, color, dialogContent),
        deleteLayer: (layerId: string) => this._deleteLayer(layerId, dialogContent)
      });
      
      // Show the dialog
      const result = await showDialog({
        title: 'Layer Control',
        hasClose: true,
        body: dialogContent,
        buttons: []
      });

      console.log('Layer control dialog closed');
    } catch (error) {
      console.error('Error showing layer control dialog:', error);
    }
  }

  /**
   * Get layer information from the ImageViewerWidget
   */
  private _getLayerInfo(): LayerInfo[] {
    // Use the ImageViewerWidget's getLayerInfo method to get actual layer state
    if (typeof (this._imageViewerWidget as any).getLayerInfo === 'function') {
      return (this._imageViewerWidget as any).getLayerInfo();
    }
    
    // Fallback to manual construction if method doesn't exist
    const layers: LayerInfo[] = [];
    
    // Get feature layers
    const featureLayers = (this._imageViewerWidget as any).featureLayers;
    if (featureLayers && featureLayers instanceof Map) {
      for (const [layerId, layer] of featureLayers.entries()) {
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
      for (const [layerId, layer] of modelLayers.entries()) {
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
  private _toggleLayerVisibility(layerId: string, dialog?: LayerControlDialog): void {
    try {
      console.log(`Toggling visibility for layer: ${layerId}`);
      
      // Call method on ImageViewerWidget if it exists
      if (typeof (this._imageViewerWidget as any).setLayerVisibility === 'function') {
        const currentLayers = this._getLayerInfo();
        const layer = currentLayers.find(l => l.id === layerId);
        const newVisibility = layer ? !layer.visible : true;
        (this._imageViewerWidget as any).setLayerVisibility(layerId, newVisibility);
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
  private _updateLayerColor(layerId: string, color: [number, number, number, number], dialog?: LayerControlDialog): void {
    try {
      console.log(`Updating color for layer ${layerId}:`, color);
      
      // Call method on ImageViewerWidget if it exists
      if (typeof (this._imageViewerWidget as any).setLayerColor === 'function') {
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
      console.log(`Deleting layer: ${layerId}`);
      
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
   * Set button title based on layer availability - button is always enabled
   */
  public updateButtonTitle(): void {
    const layers = this._getLayerInfo();
    
    this._button.disabled = false;
    this._button.classList.remove('jp-mod-disabled');
    this._button.title = 'Manage overlay layers';
  }

  /**
   * Update button state when layers change
   */
  public onLayersChanged(): void {
    this.updateButtonTitle();
  }

  /**
   * Set button enabled/disabled state - kept for backward compatibility but always enables
   */
  public setEnabled(enabled: boolean): void {
    // Always keep button enabled regardless of parameter
    this._button.disabled = false;
    this._button.classList.remove('jp-mod-disabled');
    this.updateButtonTitle();
  }

  /**
   * Handle dispose
   */
  dispose(): void {
    if (this._button) {
      this._button.removeEventListener('click', this._handleClick.bind(this));
    }
    super.dispose();
  }

  /**
   * Handle after attach
   */
  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.node.addEventListener('click', this, true);
  }

  /**
   * Handle before detach
   */
  protected onBeforeDetach(msg: Message): void {
    this.node.removeEventListener('click', this, true);
    super.onBeforeDetach(msg);
  }

  /**
   * Handle DOM events
   */
  handleEvent(event: Event): void {
    switch (event.type) {
      case 'click':
        // Prevent the double click issue by only handling the direct button click
        if (event.target === this._button) {
          this._handleClick();
        }
        break;
    }
  }
}

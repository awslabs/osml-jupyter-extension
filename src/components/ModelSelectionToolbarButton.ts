// Copyright Amazon.com, Inc. or its affiliates.

import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { showDialog, Dialog } from '@jupyterlab/apputils';
import { ImageViewerWidget } from '../ImageViewerWidget';
import ModelSelectionDialog, {
  IModelSelectionResult
} from './ModelSelectionDialog';

/**
 * A toolbar button widget for model selection
 */
export class ModelSelectionToolbarButton extends Widget {
  private _modelName: string = '';
  private _modelEnabled: boolean = false;
  private _button: HTMLButtonElement;

  constructor(private _imageViewerWidget: ImageViewerWidget) {
    super();
    this.addClass('jp-ToolbarButton');
    this.addClass('jp-mod-styled');

    // Create the button element
    this._button = document.createElement('button');
    this._button.className =
      'jp-ToolbarButtonComponent jp-Button jp-mod-minimal jp-model-selection-toolbar-button';
    this._button.title = 'Select model to run on tiles';
    this._button.setAttribute('data-command', 'model-selection');

    // Create button content
    this._updateButtonContent();

    // Add click handler
    this._button.addEventListener('click', this._handleClick.bind(this));

    this.node.appendChild(this._button);
  }

  /**
   * Update the button content based on current model selection
   */
  private _updateButtonContent(): void {
    // Clear existing content
    this._button.innerHTML = '';

    // Create icon span (using a generic model icon)
    const iconSpan = document.createElement('span');
    iconSpan.className = 'jp-toolbar-button-component-icon';
    iconSpan.innerHTML = '🤖'; // Using emoji for now, could be replaced with proper icon

    this._button.appendChild(iconSpan);
  }

  /**
   * Handle button click - show model selection dialog
   */
  private async _handleClick(): Promise<void> {
    try {
      // Get CommService from the ImageViewerWidget
      const commService = (this._imageViewerWidget as any).commService;

      // Create the dialog content with current state
      const dialogContent = new ModelSelectionDialog(
        this._modelName,
        this._modelEnabled,
        commService
      );

      // Show the dialog with proper buttons
      const result = await showDialog({
        title: 'Model Configuration',
        hasClose: false,
        body: dialogContent,
        buttons: [
          Dialog.cancelButton({ label: 'Cancel' }),
          Dialog.okButton({ label: 'Accept' })
        ]
      });

      // Check if user clicked OK and the input is valid
      if (result.button.accept && dialogContent.isValid()) {
        // Get values directly from the dialog content
        const modelName = dialogContent.getModelName();
        const modelEnabled = dialogContent.getModelEnabled();

        this.setModelConfiguration(modelName, modelEnabled);

        // Notify the ImageViewerWidget about the model configuration
        this._imageViewerWidget.setSelectedModel(modelName, modelEnabled);

        // Handle model feature layer creation/removal
        if (modelEnabled && modelName) {
          // Create model feature layer
          this._imageViewerWidget.createModelFeatureLayer(modelName);
        } else {
          // Clear model layers if model is disabled or no model name
          this._imageViewerWidget.clearModelLayers();
        }
      }
    } catch (error) {
      console.error('Error showing model selection dialog:', error);
    }
  }

  /**
   * Set the current model configuration
   */
  public setModelConfiguration(modelName: string, modelEnabled: boolean): void {
    this._modelName = modelName;
    this._modelEnabled = modelEnabled;
    this._updateButtonContent();

    if (!modelEnabled) {
      this._button.title = 'Model processing disabled - Click to configure';
    } else if (modelName) {
      this._button.title = `Current model: ${modelName}`;
    } else {
      this._button.title =
        'Model enabled but no name specified - Click to configure';
    }
  }

  /**
   * Set the current model name (legacy method for backward compatibility)
   */
  public setModelName(modelName: string): void {
    this.setModelConfiguration(modelName, true);
  }

  /**
   * Get the current model name
   */
  public getModelName(): string {
    return this._modelName;
  }

  /**
   * Get the current model enabled state
   */
  public getModelEnabled(): boolean {
    return this._modelEnabled;
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

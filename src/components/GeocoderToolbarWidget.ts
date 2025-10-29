// Copyright Amazon.com, Inc. or its affiliates.

import { Widget } from '@lumino/widgets';
import { runIcon } from '@jupyterlab/ui-components';
import { ImageViewerWidget } from '../ImageViewerWidget';
import { logger } from '../utils';

/**
 * A compact toolbar widget that displays a text input for coordinate entry
 * and handles navigation to those coordinates using the GeocoderService
 */
export class GeocoderToolbarWidget extends Widget {
  private inputElement?: HTMLInputElement;
  private addressText: string = '';

  constructor(private _imageViewerWidget: ImageViewerWidget) {
    super();
    this.addClass('geocoder-toolbar-widget');
    this._createWidget();
  }

  /**
   * Create the widget elements
   */
  private _createWidget(): void {
    // Create container div
    const container = document.createElement('div');
    container.className = 'geocoder-toolbar-container';
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      font-family: var(--jp-ui-font-family);
      font-size: var(--jp-ui-font-size1);
      min-width: 250px;
    `;

    // Create input element
    this.inputElement = document.createElement('input');
    this.inputElement.type = 'text';
    this.inputElement.placeholder = 'Enter coordinates (x,y or lat,lon)';
    this.inputElement.value = this.addressText;
    this.inputElement.style.cssText = `
      flex: 1;
      min-width: 200px;
      height: 24px;
      margin: 0;
      padding: 2px 6px;
      border: 1px solid var(--jp-border-color1);
      border-radius: var(--jp-border-radius);
      background: var(--jp-layout-color1);
      color: var(--jp-ui-font-color1);
      font-size: var(--jp-ui-font-size1);
      font-family: var(--jp-ui-font-family);
      outline: none;
      box-sizing: border-box;
    `;

    // Add input event listeners
    this.inputElement.addEventListener('input', e => {
      const target = e.target as HTMLInputElement;
      this.addressText = target.value;
    });

    this.inputElement.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        this._handleSubmit();
      }
    });

    // Focus/blur styles
    this.inputElement.addEventListener('focus', () => {
      this.inputElement!.style.borderColor = 'var(--jp-brand-color1)';
      this.inputElement!.style.boxShadow = '0 0 0 1px var(--jp-brand-color1)';
    });

    this.inputElement.addEventListener('blur', () => {
      this.inputElement!.style.borderColor = 'var(--jp-border-color1)';
      this.inputElement!.style.boxShadow = 'none';
    });

    // Create submit button with icon
    const submitButton = document.createElement('button');
    submitButton.title = 'Navigate to coordinates';
    submitButton.style.cssText = `
      margin: 0;
      padding: 4px;
      background: var(--jp-layout-color1);
      color: var(--jp-ui-font-color1);
      border: 1px solid var(--jp-border-color1);
      border-radius: var(--jp-border-radius);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      transition: all 0.1s ease;
      box-sizing: border-box;
    `;

    // Add the run icon to the button
    runIcon.element({
      container: submitButton,
      width: '16px',
      height: '16px'
    });

    submitButton.addEventListener('click', () => {
      this._handleSubmit();
    });

    // Hover effects for button
    submitButton.addEventListener('mouseenter', () => {
      submitButton.style.background = 'var(--jp-layout-color2)';
      submitButton.style.borderColor = 'var(--jp-border-color2)';
    });

    submitButton.addEventListener('mouseleave', () => {
      submitButton.style.background = 'var(--jp-layout-color1)';
      submitButton.style.borderColor = 'var(--jp-border-color1)';
    });

    // Add elements to container
    container.appendChild(this.inputElement);
    container.appendChild(submitButton);

    this.node.appendChild(container);
  }

  /**
   * Handle form submission
   */
  private _handleSubmit(): void {
    const trimmedText = this.addressText.trim();

    if (!trimmedText) {
      this._emitStatus('Please enter coordinates');
      return;
    }

    // Use the geocoding functionality from the ImageViewerWidget
    this._geocode(trimmedText);
  }

  /**
   * Geocode the input text and navigate to the result
   */
  private async _geocode(text: string): Promise<void> {
    try {
      this._emitStatus(`Processing coordinates: ${text}`);

      // Get the geocoder service from the ImageViewerWidget
      const geocoderService = (this._imageViewerWidget as any).geocoderService;
      if (!geocoderService) {
        throw new Error('GeocoderService not available');
      }

      // Create a custom geocoder function from the service
      const customGeocoder = geocoderService.createCustomGeocoder();

      // Call the geocoder
      const result = await customGeocoder(text);

      // Navigate to the result coordinates using the ImageViewerWidget's navigation method
      this._imageViewerWidget.navigateToCoordinates(
        result.longitude,
        result.latitude
      );

      logger.info(
        `Geocoder navigation successful: x=${result.longitude}, y=${result.latitude}`
      );
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to process coordinates';
      this._emitStatus(`Coordinate navigation error: ${errorMessage}`);
      logger.error(`Geocoder navigation failed: ${errorMessage}`);
    }
  }

  /**
   * Emit status message to the ImageViewerWidget's status signal
   */
  private _emitStatus(message: string): void {
    if (this._imageViewerWidget && this._imageViewerWidget.statusSignal) {
      this._imageViewerWidget.statusSignal.emit(message);
    }
  }

  /**
   * Clear the input field
   */
  public clearInput(): void {
    this.addressText = '';
    if (this.inputElement) {
      this.inputElement.value = '';
    }
  }

  /**
   * Focus the input field
   */
  public focusInput(): void {
    if (this.inputElement) {
      this.inputElement.focus();
    }
  }

  /**
   * Get the current input value
   */
  public getInputValue(): string {
    return this.addressText;
  }

  /**
   * Set the input value
   */
  public setInputValue(value: string): void {
    this.addressText = value;
    if (this.inputElement) {
      this.inputElement.value = value;
    }
  }
}

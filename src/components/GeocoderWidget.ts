// Copyright Amazon.com, Inc. or its affiliates.

import { Widget } from '@deck.gl/core';
import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';
import { runIcon } from '@jupyterlab/ui-components';
import { GeocoderService } from '../services/GeocoderService';
import { logger } from '../utils';

/** Properties for the GeocoderWidget */
export type GeocoderWidgetProps = WidgetProps & {
  viewId?: string | null;
  /** Widget positioning within the view. Default 'top-left'. */
  placement?: WidgetPlacement;
  /** Tooltip message */
  label?: string;
  /** View state reset transition duration in ms. 0 disables the transition */
  transitionDuration?: number;
  /** Callback function to handle navigation to coordinates */
  onNavigate?: (x: number, y: number) => void;
  /** Callback function to handle status messages */
  onStatus?: (message: string) => void;
  /** GeocoderService instance for coordinate processing */
  geocoderService?: GeocoderService;
};

/**
 * A custom widget that displays a text input for coordinate entry
 * and handles navigation to those coordinates using the GeocoderService
 */
export class GeocoderWidget extends Widget<GeocoderWidgetProps> {
  static defaultProps: Required<GeocoderWidgetProps> = {
    ...Widget.defaultProps,
    id: 'custom-geocoder',
    viewId: null,
    placement: 'top-right',
    label: 'Navigate to coordinates',
    transitionDuration: 500,
    onNavigate: () => {},
    onStatus: () => {},
    geocoderService: undefined as any // Will be provided in constructor
  };

  className = 'deck-widget-custom-geocoder';
  placement: WidgetPlacement = 'top-left';

  private inputElement?: HTMLInputElement;
  private addressText: string = '';
  private errorText: string = '';

  constructor(props: GeocoderWidgetProps = {}) {
    super(props);
    this.setProps(this.props);
  }

  setProps(props: Partial<GeocoderWidgetProps>): void {
    this.placement = props.placement ?? this.placement;
    this.viewId = props.viewId ?? this.viewId;
    super.setProps(props);
  }

  onRenderHTML(rootElement: HTMLElement): void {
    // Store reference for later use in error handling
    this.element = rootElement;

    // Clear existing content
    rootElement.innerHTML = '';

    // Create container div
    const container = document.createElement('div');
    container.className = 'deck-widget-custom-geocoder';
    container.style.cssText = `
      pointer-events: auto;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      background: rgba(255, 255, 255, 0.95);
      border-radius: 4px;
      padding: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    `;

    // Create input element
    this.inputElement = document.createElement('input');
    this.inputElement.type = 'text';
    this.inputElement.placeholder = 'Enter coordinates (x,y or lat,lon)';
    this.inputElement.value = this.addressText;
    this.inputElement.style.cssText = `
      flex: 1 1 auto;
      min-width: 300px;
      margin: 0;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 3px;
      box-sizing: border-box;
      font-size: 14px;
      outline: none;
    `;

    // Add input event listeners
    this.inputElement.addEventListener('input', e => {
      const target = e.target as HTMLInputElement;
      this.setInput(target.value);
    });

    this.inputElement.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        this.handleSubmit();
      }
    });

    // Create submit button with icon
    const submitButton = document.createElement('button');
    submitButton.title = 'Navigate to coordinates'; // Tooltip
    submitButton.style.cssText = `
      margin-left: 4px;
      padding: 8px;
      background: var(--jp-layout-color1);
      color: var(--jp-ui-font-color1);
      border: 1px solid var(--jp-border-color1);
      border-radius: var(--jp-border-radius);
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      height: 32px;
      transition: all 0.1s ease;
    `;

    // Add the run icon to the button
    runIcon.element({
      container: submitButton,
      width: '16px',
      height: '16px'
    });

    submitButton.addEventListener('click', () => {
      this.handleSubmit();
    });

    // Hover effects for button using JupyterLab theme variables
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

    // Create error display if needed
    if (this.errorText) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error';
      errorDiv.textContent = this.errorText;
      errorDiv.style.cssText = `
        width: 100%;
        margin-top: 4px;
        padding: 4px 8px;
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
        border-radius: 3px;
        font-size: 12px;
      `;
      container.appendChild(errorDiv);
    }

    rootElement.appendChild(container);
  }

  private setInput = (text: string): void => {
    this.addressText = text;
    this.clearError();
  };

  private handleSubmit = (): void => {
    if (!this.props.geocoderService) {
      this.showError('GeocoderService not available');
      return;
    }

    if (!this.addressText.trim()) {
      this.showError('Please enter coordinates');
      return;
    }

    // Use the GeocoderService to process coordinates
    this.geocode(this.addressText.trim());
  };

  private geocode = async (text: string): Promise<void> => {
    try {
      this.clearError();

      if (this.props.onStatus) {
        this.props.onStatus(`Processing coordinates: ${text}`);
      }

      // Create a custom geocoder function from the service
      const customGeocoder = this.props.geocoderService!.createCustomGeocoder();

      // Call the geocoder
      const result = await customGeocoder(text);

      // Navigate to the result coordinates
      if (this.props.onNavigate) {
        this.props.onNavigate(result.longitude, result.latitude);
      }

      if (this.props.onStatus) {
        this.props.onStatus(
          `Navigated to coordinates: ${result.longitude.toFixed(2)}, ${result.latitude.toFixed(2)}`
        );
      }

      logger.info(
        `Geocoder navigation successful: x=${result.longitude}, y=${result.latitude}`
      );
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to process coordinates';
      this.showError(errorMessage);

      if (this.props.onStatus) {
        this.props.onStatus(`Coordinate navigation error: ${errorMessage}`);
      }

      logger.error(`Geocoder navigation failed: ${errorMessage}`);
    }
  };

  private showError = (message: string): void => {
    this.errorText = message;
    // Re-render to show error
    if (this.element) {
      this.onRenderHTML(this.element);
    }
  };

  private clearError = (): void => {
    if (this.errorText) {
      this.errorText = '';
      // Re-render to hide error
      if (this.element) {
        this.onRenderHTML(this.element);
      }
    }
  };

  // Store reference to the root element for re-rendering
  private element?: HTMLElement;
}

// Copyright Amazon.com, Inc. or its affiliates.

import {
  IPropertyInspector,
  IPropertyInspectorProvider
} from '@jupyterlab/property-inspector';
import * as React from 'react';
import { ImageViewerPropertyInspector } from '../components';
import { ISelectionChangedArgs, IImageInfo, ICurrentSelection } from '../types';
import { logger } from '../utils';

/**
 * Manages property inspector integration for ImageViewerWidget through signals
 */
export class PropertyInspectorManager {
  private propertyInspector?: IPropertyInspector;
  private currentSelection: ICurrentSelection = { type: null };
  private imageInfo: IImageInfo = {};

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
   * Update the property inspector content
   */
  private updatePropertyInspectorContent(): void {
    if (!this.propertyInspector) {
      return;
    }

    const content = React.createElement(ImageViewerPropertyInspector, {
      currentSelection: this.currentSelection,
      imageInfo: this.imageInfo
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

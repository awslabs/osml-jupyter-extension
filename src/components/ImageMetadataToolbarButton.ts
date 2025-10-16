// Copyright Amazon.com, Inc. or its affiliates.

import { ToolbarButton } from '@jupyterlab/apputils';
import { ImageViewerWidget } from '../ImageViewerWidget';
import { codeIcon } from '../utils/icons';
import ImageMetadataDialog from './ImageMetadataDialog';

/**
 * A toolbar button widget for displaying image metadata
 */
export class ImageMetadataToolbarButton extends ToolbarButton {
  constructor(private _imageViewerWidget: ImageViewerWidget) {
    super({
      icon: codeIcon,
      onClick: () => this._handleClick(),
      tooltip: 'View image metadata and properties'
    });
  }

  /**
   * Handle button click - show image metadata dialog
   */
  private async _handleClick(): Promise<void> {
    try {
      // Get the current image name from the ImageViewerWidget
      const imageName = this._getImageName();

      if (!imageName) {
        console.warn('No image loaded - cannot show metadata');
        // You could show a notification here if needed
        return;
      }

      // Get CommService from the ImageViewerWidget
      const commService = (this._imageViewerWidget as any).commService;

      if (!commService) {
        console.error('CommService not available');
        return;
      }

      // Show the modal dialog directly without JupyterLab dialog wrapper
      const dialogWidget = new ImageMetadataDialog(
        imageName,
        commService,
        () => {
          // Close callback - remove the dialog from DOM
          if (dialogWidget.node.parentElement) {
            dialogWidget.node.remove();
          }
          dialogWidget.dispose();
        }
      );

      // Add to document body for proper modal behavior
      document.body.appendChild(dialogWidget.node);

      // Force the widget to render
      dialogWidget.update();

      console.log('Metadata dialog opened');
    } catch (error) {
      console.error('Error showing image metadata dialog:', error);
    }
  }

  /**
   * Get the current image name from the ImageViewerWidget
   */
  private _getImageName(): string | undefined {
    // Access the private imageName property from ImageViewerWidget
    return (this._imageViewerWidget as any).imageName;
  }

  /**
   * Set button enabled/disabled state based on image availability
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Update button state when image changes
   */
  public onImageChanged(imageName: string | undefined): void {
    this.setEnabled(!!imageName);
  }
}

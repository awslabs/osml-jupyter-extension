// Copyright Amazon.com, Inc. or its affiliates.

import { AbstractCommand } from './AbstractCommand';
import { Contents } from '@jupyterlab/services';
import { logger } from './utils';

/**
 * Command class for opening images with the OversightML viewer
 */
export class OpenImageCommand extends AbstractCommand {
  protected async executeCommandLogic(
    selectedFileName: string | null
  ): Promise<void> {
    if (!this.sharedState.widget || !this.sharedState.serviceContainer) {
      throw new Error('Widget not initialized');
    }

    // If an image was selected, load it via ImageManager
    if (selectedFileName) {
      try {
        this.sharedState.widget.statusSignal.emit(
          `Loading ${selectedFileName} ...`
        );

        // Get services from container
        const services = this.sharedState.serviceContainer.getServices();
        const { imageManager } = services;

        // Use ImageManager to load the image - this will handle all tile service operations internally
        await imageManager.loadImage(selectedFileName);

        logger.info(
          `Image ${selectedFileName} loaded successfully via command.`
        );
      } catch (error: any) {
        logger.error(
          `Failed to load image ${selectedFileName}: ${error.message}`
        );
        console.error('Error loading image:', error);
        this.sharedState.widget.statusSignal.emit(
          `Error loading ${selectedFileName}: ${error.message}`
        );
      }
    }
  }

  /**
   * Check if this command should be visible based on selected files
   * Only show for image files with extensions: .ntf, .nitf, .tiff, .tif
   */
  protected checkVisibility(selectedFiles: Contents.IModel[]): boolean {
    if (selectedFiles.length === 0) {
      return false;
    }

    const imageExtensions = ['.ntf', '.nitf', '.tiff', '.tif'];

    return selectedFiles.some(file => {
      const fileName = file.name.toLowerCase();
      return imageExtensions.some(ext => fileName.endsWith(ext));
    });
  }
}

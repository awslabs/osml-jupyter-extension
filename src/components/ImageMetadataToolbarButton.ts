import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { showDialog, Dialog } from '@jupyterlab/apputils';
import { ImageViewerWidget } from '../ImageViewerWidget';
import ImageMetadataDialog from './ImageMetadataDialog';

/**
 * A toolbar button widget for displaying image metadata
 */
export class ImageMetadataToolbarButton extends Widget {
  private _button: HTMLButtonElement;

  constructor(private _imageViewerWidget: ImageViewerWidget) {
    super();
    this.addClass('jp-ToolbarButton');
    this.addClass('jp-mod-styled');
    
    // Create the button element
    this._button = document.createElement('button');
    this._button.className = 'jp-ToolbarButtonComponent jp-Button jp-mod-minimal jp-ImageMetadataToolbarButton';
    this._button.title = 'View image metadata and properties';
    this._button.setAttribute('data-command', 'image-metadata');
    
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
    
    // Create icon span (using document/info icon)
    const iconSpan = document.createElement('span');
    iconSpan.className = 'jp-ToolbarButtonComponent-icon';
    iconSpan.innerHTML = '📄'; // Using document emoji as icon
    
    // Create label span
    const labelSpan = document.createElement('span');
    labelSpan.className = 'jp-ToolbarButtonComponent-label';
    labelSpan.textContent = 'Image Info';
    
    this._button.appendChild(iconSpan);
    this._button.appendChild(labelSpan);
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

      // Create the dialog content
      const dialogContent = new ImageMetadataDialog(imageName, commService);
      
      // Show the dialog
      const result = await showDialog({
        title: 'Image Metadata',
        hasClose: true,
        body: dialogContent,
        buttons: [
          Dialog.okButton({ label: 'Close' })
        ],
        defaultButton: 0,
        focusNodeSelector: 'input[type="search"]' // Focus the search input when dialog opens
      });

      console.log('Metadata dialog closed');
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
    this._button.disabled = !enabled;
    
    if (enabled) {
      this._button.title = 'View image metadata and properties';
      this._button.classList.remove('jp-mod-disabled');
    } else {
      this._button.title = 'No image loaded - metadata not available';
      this._button.classList.add('jp-mod-disabled');
    }
  }

  /**
   * Update button state when image changes
   */
  public onImageChanged(imageName: string | undefined): void {
    this.setEnabled(!!imageName);
    
    if (imageName) {
      this._button.title = `View metadata for ${imageName}`;
    }
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

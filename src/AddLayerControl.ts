/**
 * AddLayerControl: Legacy Leaflet control - no longer used with Deck.gl implementation.
 * This file is kept for backward compatibility but the functionality has been moved
 * to the main ImageViewerWidget.
 * 
 * @deprecated This control is no longer used with the Deck.gl implementation
 */

export interface AddLayerControlOptions {
  // Placeholder for backward compatibility
}

/**
 * Legacy factory function - no longer functional with Deck.gl
 * @deprecated Use ImageViewerWidget.addLayer() method instead
 */
export function addLayerControl(callback: any, options?: AddLayerControlOptions) {
  console.warn('AddLayerControl is deprecated. Use ImageViewerWidget.addLayer() method instead.');
  return null;
}

/**
 * Legacy class - no longer functional with Deck.gl
 * @deprecated Use ImageViewerWidget.addLayer() method instead
 */
export class AddLayerControl {
  constructor(callback: any, options?: AddLayerControlOptions) {
    console.warn('AddLayerControl is deprecated. Use ImageViewerWidget.addLayer() method instead.');
  }
}

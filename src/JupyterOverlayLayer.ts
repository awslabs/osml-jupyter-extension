/**
 * JupyterOverlayLayer: Legacy Leaflet-based overlay layer - replaced by DeckJupyterOverlayLayer.
 * This file is kept for backward compatibility but functionality has been moved to Deck.gl implementation.
 * 
 * @deprecated Use DeckJupyterOverlayLayer instead
 */

import { Kernel } from '@jupyterlab/services';
import { IJupyterImageLayerOptions } from './IJupyterImageLayerOptions';

/**
 * Legacy JupyterOverlayLayer class - no longer functional
 * @deprecated Use DeckJupyterOverlayLayer instead
 */
export const JupyterOverlayLayer = {
  extend: () => {
    console.warn('JupyterOverlayLayer is deprecated. Use DeckJupyterOverlayLayer instead.');
    return null;
  }
};

/**
 * Legacy factory function - no longer functional
 * @deprecated Use createDeckJupyterOverlayLayer instead
 */
export function jupyterOverlayLayer(
  comm: Kernel.IComm | undefined,
  imageName: string,
  overlayName: string,
  options: IJupyterImageLayerOptions
) {
  console.warn('jupyterOverlayLayer is deprecated. Use createDeckJupyterOverlayLayer instead.');
  return null;
}

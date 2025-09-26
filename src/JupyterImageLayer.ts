/**
 * JupyterImageLayer: Legacy Leaflet-based image layer - replaced by DeckJupyterImageLayer.
 * This file is kept for backward compatibility but functionality has been moved to Deck.gl implementation.
 * 
 * @deprecated Use DeckJupyterImageLayer instead
 */

import { Kernel } from '@jupyterlab/services';
import { IJupyterImageLayerOptions } from './IJupyterImageLayerOptions';

/**
 * Legacy JupyterImageLayer class - no longer functional
 * @deprecated Use DeckJupyterImageLayer instead
 */
export const JupyterImageLayer = {
  extend: () => {
    console.warn('JupyterImageLayer is deprecated. Use DeckJupyterImageLayer instead.');
    return null;
  }
};

/**
 * Legacy factory function - no longer functional
 * @deprecated Use createDeckJupyterImageLayer instead
 */
export function jupyterImageLayer(
  comm: Kernel.IComm,
  imageName: string,
  options: IJupyterImageLayerOptions
) {
  console.warn('jupyterImageLayer is deprecated. Use createDeckJupyterImageLayer instead.');
  return null;
}

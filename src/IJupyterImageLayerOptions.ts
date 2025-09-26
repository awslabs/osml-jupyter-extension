/**
 * Interface for Jupyter image layer options.
 * This is kept for backward compatibility but should be replaced with IDeckImageLayerOptions.
 * @deprecated Use IDeckImageLayerOptions instead
 */
export interface IJupyterImageLayerOptions {
  tileSize?: number;
  minNativeZoom?: number;
  maxNativeZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  opacity?: number;
  visible?: boolean;
}

/**
 * Interface for Deck.gl-based image layer options.
 * This replaces the Leaflet GridLayerOptions with Deck.gl-specific configuration.
 */
export interface IDeckImageLayerOptions {
  tileSize?: number;
  minNativeZoom?: number;
  maxNativeZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  opacity?: number;
  visible?: boolean;
}

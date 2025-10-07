// Re-export all types for easy importing
export * from './tiles';
export * from './features';
export * from './models';

/**
 * Common application types
 */

/**
 * Widget state interface
 */
export interface WidgetState {
  isInitialized: boolean;
  isLoading: boolean;
  error?: string;
  imageName?: string;
}

/**
 * Communication message types
 */
export type CommMessageType = 
  | 'IMAGE_LOAD_REQUEST'
  | 'IMAGE_LOAD_RESPONSE'
  | 'IMAGE_TILE_REQUEST'
  | 'IMAGE_TILE_RESPONSE'
  | 'OVERLAY_TILE_REQUEST'
  | 'OVERLAY_TILE_RESPONSE'
  | 'MODEL_TILE_REQUEST'
  | 'MODEL_TILE_RESPONSE'
  | 'LIST_AVAILABLE_ENDPOINTS'
  | 'LIST_AVAILABLE_ENDPOINTS_RESPONSE'
  | 'IMAGE_METADATA_REQUEST'
  | 'IMAGE_METADATA_RESPONSE'
  | 'KERNEL_COMM_SETUP_COMPLETE';

/**
 * Communication message interface
 */
export interface CommMessage {
  type: CommMessageType;
  dataset?: string;
  imageName?: string;
  overlayName?: string;
  endpointName?: string;  // For MODEL_TILE_REQUEST
  zoom?: number;
  row?: number;
  col?: number;
  status?: string;
  img?: string;
  features?: any[];
  error?: string;
  imageCoordinates?: number[][];  // For IMAGE_TO_WORLD and WORLD_TO_IMAGE
  worldCoordinates?: number[][];  // For IMAGE_TO_WORLD and WORLD_TO_IMAGE
  endpoints?: any[];  // For LIST_AVAILABLE_ENDPOINTS_RESPONSE
  metadata?: MetadataObject;  // For IMAGE_METADATA_RESPONSE
}

/**
 * Metadata type definitions for flexible hierarchical data
 */
export interface MetadataObject {
  [key: string]: MetadataValue;
}

export type MetadataValue = string | number | boolean | null | MetadataObject | MetadataValue[];

/**
 * Debug information interface
 */
export interface DebugInfo {
  useMockData: boolean;
  useMockFeatureData: boolean;
  enableDebugLogging: boolean;
  featureLayerCount: number;
  featureLayerNames: string[];
  imageName?: string;
  deckInstanceExists: boolean;
  selectedModel: string;
  selectedModelEnabled: boolean;
}

/**
 * Layer configuration base interface
 */
export interface LayerConfigBase {
  id: string;
  visible?: boolean;
  opacity?: number;
  pickable?: boolean;
}

/**
 * Viewport state interface
 */
export interface ViewportState {
  target: [number, number, number];
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Layer management types
 */
export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
  color: [number, number, number, number]; // RGBA
  type: 'feature' | 'model';
}

export interface LayerControlActions {
  toggleVisibility: (layerId: string) => void;
  updateColor: (layerId: string, color: [number, number, number, number]) => void;
  deleteLayer: (layerId: string) => void;
}

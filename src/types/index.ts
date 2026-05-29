// Copyright Amazon.com, Inc. or its affiliates.

// Re-export all types for easy importing
export * from './tiles';
export * from './features';
export * from './models';
export * from './signals';

import { FeatureTileDataFunction } from './tiles';

/**
 * Common application types
 */

/**
 * Widget state interface
 */
export interface IWidgetState {
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
  | 'OVERLAY_LOAD_REQUEST'
  | 'OVERLAY_LOAD_RESPONSE'
  | 'OVERLAY_TILE_REQUEST'
  | 'OVERLAY_TILE_RESPONSE'
  | 'MODEL_TILE_REQUEST'
  | 'MODEL_TILE_RESPONSE'
  | 'LIST_AVAILABLE_ENDPOINTS'
  | 'LIST_AVAILABLE_ENDPOINTS_RESPONSE'
  | 'IMAGE_METADATA_REQUEST'
  | 'IMAGE_METADATA_RESPONSE'
  | 'WORLD_TO_IMAGE_REQUEST'
  | 'WORLD_TO_IMAGE_RESPONSE'
  | 'IMAGE_TO_WORLD_REQUEST'
  | 'IMAGE_TO_WORLD_RESPONSE'
  | 'PYRAMID_BUILD_REQUEST'
  | 'PYRAMID_BUILD_RESPONSE'
  | 'KERNEL_COMM_SETUP_COMPLETE'
  | PushMessageType;

/**
 * Kernel -> frontend push (render command) message types. These form the
 * inbound "push channel"; they are disjoint from the request/response
 * `*_RESPONSE` types so the persistent demultiplexer can route them without
 * touching the tile-fetch hot path.
 */
export type PushMessageType =
  | 'ADD_LAYER'
  | 'REMOVE_LAYER'
  | 'SET_VIEW'
  | 'GOTO';

/**
 * The set of push types, for runtime membership checks in the demultiplexer.
 */
export const PUSH_MESSAGE_TYPES: ReadonlySet<PushMessageType> =
  new Set<PushMessageType>(['ADD_LAYER', 'REMOVE_LAYER', 'SET_VIEW', 'GOTO']);

/**
 * Frontend -> kernel fire-and-forget "state stream" message types. These form a
 * third category alongside request/response and the push channel: they feed the
 * kernel-side `ViewStateStore` and expect no `*_RESPONSE`. Sent via
 * `CommService.sendOneWay`.
 */
export type StateStreamMessageType = 'VIEW_STATE_UPDATE' | 'CLICK_EVENT';

/**
 * Fires after the viewport settles (~300 ms of stillness). Carries the current
 * view rectangle in full-image pixel space plus zoom and the current image.
 */
export interface IViewStateUpdateMessage {
  type: 'VIEW_STATE_UPDATE';
  imageName: string;
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  zoom: number;
}

/**
 * Emitted once per click. Carries the click location in full-image pixel space;
 * `feature` (the picked object) and `layerId` are present only when a feature
 * was hit. The frontend does not compute world coordinates here.
 */
export interface IClickEventMessage {
  type: 'CLICK_EVENT';
  imageName: string;
  x: number;
  y: number;
  feature?: unknown;
  layerId?: string;
}

/**
 * Kernel -> frontend push message. Carries a render command routed by
 * `PushDispatcher`. Fields are optional and interpreted per `type`.
 */
export interface IPushMessage {
  type: PushMessageType;
  /** Layer name for ADD_LAYER / REMOVE_LAYER. */
  name?: string;
  /** Optional style hints for ADD_LAYER. */
  style?: IMetadataObject;
  /** Target image-space coordinates for SET_VIEW / GOTO. */
  x?: number;
  y?: number;
  /** Target zoom for SET_VIEW / GOTO. */
  zoom?: number;
  /** Owning image name for ADD_LAYER (defaults to current image). */
  imageName?: string;
}

/**
 * Minimal navigation surface the `PushDispatcher` needs from the viewer widget.
 * Declared as an interface (rather than importing `ImageViewerWidget`) to avoid
 * a service -> widget circular import.
 */
export interface IViewerNavigator {
  navigateToCoordinates(x: number, y: number, zoom?: number): void;
}

/**
 * Minimal layer-rendering surface the `PushDispatcher` needs to apply
 * `ADD_LAYER` / `REMOVE_LAYER` pushes. Structurally satisfied by `LayerManager`.
 */
export interface ILayerRenderer {
  addFeatureLayer(layerId: string, getTileData: FeatureTileDataFunction): void;
  deleteLayer(layerId: string): void;
}

/**
 * Minimal factory surface for feature-tile data functions the `PushDispatcher`
 * needs for `ADD_LAYER` pushes. Structurally satisfied by `FeatureTileService`.
 */
export interface IFeatureDataFunctionFactory {
  createFeatureDataFunction(
    imageName: string,
    overlayName: string
  ): FeatureTileDataFunction;
}

/**
 * Communication message interface
 */
export interface ICommMessage {
  type: CommMessageType;
  dataset?: string;
  imageName?: string;
  overlayName?: string;
  endpointName?: string; // For MODEL_TILE_REQUEST
  zoom?: number;
  row?: number;
  col?: number;
  status?: string;
  img?: string;
  features?: any[];
  error?: string;
  imageCoordinates?: number[][]; // For IMAGE_TO_WORLD and WORLD_TO_IMAGE
  worldCoordinates?: number[][]; // For IMAGE_TO_WORLD and WORLD_TO_IMAGE
  endpoints?: any[]; // For LIST_AVAILABLE_ENDPOINTS_RESPONSE
  metadata?: IMetadataObject; // For IMAGE_METADATA_RESPONSE
}

/**
 * Metadata type definitions for flexible hierarchical data
 */
export interface IMetadataObject {
  [key: string]: MetadataValue;
}

export type MetadataValue =
  | string
  | number
  | boolean
  | null
  | IMetadataObject
  | MetadataValue[];

/**
 * Debug information interface
 */
export interface IDebugInfo {
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
export interface ILayerConfigBase {
  id: string;
  visible?: boolean;
  opacity?: number;
  pickable?: boolean;
}

/**
 * Viewport state interface
 */
export interface IViewportState {
  target: [number, number, number];
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Interface for image load response
 */
export interface IImageLoadResponse {
  success: boolean;
  status: string;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Interface for image metadata response
 */
export interface IImageMetadataResponse {
  success: boolean;
  metadata?: IMetadataObject;
  error?: string;
}

/**
 * Layer management types
 */
export interface ILayerInfo {
  id: string;
  name: string;
  visible: boolean;
  color: [number, number, number, number]; // RGBA
  type: 'feature' | 'model';
}

export interface ILayerControlActions {
  toggleVisibility: (layerId: string) => void;
  updateColor: (
    layerId: string,
    color: [number, number, number, number]
  ) => void;
  deleteLayer: (layerId: string) => void;
}

/**
 * New interface for LayerControlActions that work with LayerManager directly
 */
export interface ILayerManagerActions {
  toggleVisibility: (layerId: string) => void;
  updateColor: (
    layerId: string,
    color: [number, number, number, number]
  ) => void;
  deleteLayer: (layerId: string) => void;
  getLayerInfo: () => ILayerInfo[];
}

/**
 * Coordinate system types for GeocoderService
 */
export type CoordinateType = 'pixel' | 'world' | 'unknown';

export interface ICoordinateInput {
  type: CoordinateType;
  raw: string;
}

export interface IPixelCoordinates extends ICoordinateInput {
  type: 'pixel';
  x: number;
  y: number;
}

export interface IWorldCoordinates extends ICoordinateInput {
  type: 'world';
  latitude: number;
  longitude: number;
  elevation?: number;
}

export interface IUnknownCoordinates extends ICoordinateInput {
  type: 'unknown';
  error: string;
}

export type ParsedCoordinates =
  | IPixelCoordinates
  | IWorldCoordinates
  | IUnknownCoordinates;

/**
 * Geocoder service interfaces
 */
export interface IGeocoderResult {
  longitude: number;
  latitude: number;
}

export interface IWorldToImageResponse {
  success: boolean;
  status: string;
  imageCoordinates: number[][];
  error?: string;
}

// Copyright Amazon.com, Inc. or its affiliates.

import { IMetadataObject } from './index';

/**
 * Selection change signal arguments
 */
export interface ISelectionChangedArgs {
  type: 'location' | 'feature';
  data?: any; // Feature data for feature selections
  imageCoordinates?: { x: number; y: number };
  worldCoordinates?: { latitude: number; longitude: number; elevation: number };
  isLoadingCoordinates?: boolean; // True when coordinate conversion is in progress
  coordinateError?: string; // If coordinate conversion fails
  timestamp: number;
}

/**
 * Image information for property inspector
 */
export interface IImageInfo {
  name?: string;
  metadata?: IMetadataObject;
  isLoadingMetadata?: boolean;
  metadataError?: string;
}

/**
 * Current selection state for property inspector
 */
export interface ICurrentSelection {
  type: 'location' | 'feature' | null;
  data?: any;
  imageCoordinates?: { x: number; y: number };
  worldCoordinates?: { latitude: number; longitude: number; elevation: number };
  coordinateError?: string;
  isLoadingCoordinates?: boolean;
}

// Copyright Amazon.com, Inc. or its affiliates.

/**
 * Model selection result interface
 */
export interface IModelSelectionResult {
  modelName: string;
  modelEnabled: boolean;
  cancelled: boolean;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  name: string;
  enabled: boolean;
  endpoint?: string;
  parameters?: Record<string, any>;
}

/**
 * Model processing status
 */
export interface ModelProcessingStatus {
  isProcessing: boolean;
  progress?: number;
  message?: string;
  error?: string;
}

/**
 * Model selection dialog props
 */
export interface ModelSelectionDialogProps {
  initialModelName?: string;
  initialModelEnabled?: boolean;
  onUpdate: (modelName: string, modelEnabled: boolean) => void;
}

/**
 * SageMaker endpoint information
 */
export interface EndpointInfo {
  name: string;
  status: string;
  creationTime?: string;
  lastModifiedTime?: string;
  instanceType?: string;
}

/**
 * Response from LIST_AVAILABLE_ENDPOINTS request
 */
export interface EndpointsResponse {
  type: 'LIST_AVAILABLE_ENDPOINTS_RESPONSE';
  status: 'SUCCESS' | 'ERROR';
  endpoints?: EndpointInfo[];
  error?: string;
}

/**
 * Endpoint loading state
 */
export interface EndpointLoadingState {
  isLoading: boolean;
  error?: string;
  endpoints: EndpointInfo[];
  lastFetched?: Date;
}

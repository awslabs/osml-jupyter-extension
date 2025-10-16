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
export interface IModelConfig {
  name: string;
  enabled: boolean;
  endpoint?: string;
  parameters?: Record<string, any>;
}

/**
 * Model processing status
 */
export interface IModelProcessingStatus {
  isProcessing: boolean;
  progress?: number;
  message?: string;
  error?: string;
}

/**
 * Model selection dialog props
 */
export interface IModelSelectionDialogProps {
  initialModelName?: string;
  initialModelEnabled?: boolean;
  onUpdate: (modelName: string, modelEnabled: boolean) => void;
}

/**
 * SageMaker endpoint information
 */
export interface IEndpointInfo {
  name: string;
  status: string;
  creationTime?: string;
  lastModifiedTime?: string;
  instanceType?: string;
}

/**
 * Response from LIST_AVAILABLE_ENDPOINTS request
 */
export interface IEndpointsResponse {
  type: 'LIST_AVAILABLE_ENDPOINTS_RESPONSE';
  status: 'SUCCESS' | 'ERROR';
  endpoints?: IEndpointInfo[];
  error?: string;
}

/**
 * Endpoint loading state
 */
export interface IEndpointLoadingState {
  isLoading: boolean;
  error?: string;
  endpoints: IEndpointInfo[];
  lastFetched?: Date;
}

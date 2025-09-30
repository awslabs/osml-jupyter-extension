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

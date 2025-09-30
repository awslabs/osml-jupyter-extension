import React, { FC, useState } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';

interface ModelSelectionComponentProps {
  initialModelName?: string;
  initialModelEnabled?: boolean;
  onUpdate: (modelName: string, modelEnabled: boolean) => void;
}

const ModelSelectionComponent: FC<ModelSelectionComponentProps> = ({
  initialModelName = '',
  initialModelEnabled = false,
  onUpdate
}) => {
  // Use the initial values directly as the current state
  // This ensures the component always reflects the current dialog state
  const [modelName, setModelName] = useState(initialModelName);
  const [modelEnabled, setModelEnabled] = useState(initialModelEnabled);

  // Force reset state every time the component renders with new initial values
  React.useEffect(() => {
    setModelName(initialModelName);
    setModelEnabled(initialModelEnabled);
    // Also immediately update the parent with the initial values
    onUpdate(initialModelName, initialModelEnabled);
  }, [initialModelName, initialModelEnabled, onUpdate]);

  const handleModelNameChange = (value: string) => {
    setModelName(value);
    // Update the parent component with the current values
    onUpdate(value, modelEnabled);
  };

  const handleModelEnabledChange = (enabled: boolean) => {
    setModelEnabled(enabled);
    // Update the parent component with the current values
    onUpdate(modelName, enabled);
  };

  // Validation: if model is enabled, name must not be empty
  const isModelNameValid = !modelEnabled || modelName.trim().length > 0;

  return (
    <SpaceBetween direction="vertical" size="l">
      <div>
        <p style={{ margin: '0', fontSize: '14px' }}>Configure whether to run a model on each tile in the display.</p>
      </div>
      
      <FormField 
        label="SageMaker Endpoint Processing" 
      >
        <Toggle
          checked={modelEnabled}
          onChange={({ detail }) => handleModelEnabledChange(detail.checked)}
        >
          {modelEnabled ? 'Model Enabled' : 'Model Disabled'}
        </Toggle>
      </FormField>

      {modelEnabled && (
        <FormField 
          label="Endpoint Name" 
          description="Enter the identifier for the model endpoint you want to use"
          errorText={!isModelNameValid ? "Model endpoint name cannot be empty when model processing is enabled" : undefined}
        >
          <Input
            value={modelName}
            onChange={event => handleModelNameChange(event.detail.value)}
            placeholder="e.g., my-detection-model"
            invalid={!isModelNameValid}
            autoFocus
          />
        </FormField>
      )}
    </SpaceBetween>
  );
};

export interface IModelSelectionResult {
  modelName: string;
  modelEnabled: boolean;
  cancelled: boolean;
}

export default class ModelSelectionDialog extends ReactWidget {
  private _modelName: string = '';
  private _modelEnabled: boolean = false;
  private _isValid: boolean = true; // Always valid now since we have the toggle

  constructor(private initialModelName?: string, private initialModelEnabled?: boolean) {
    super();
    this.addClass('jp-react-widget');
    this._modelName = initialModelName || '';
    this._modelEnabled = initialModelEnabled || false;
    // Valid if model is disabled OR if model is enabled and name is not empty
    this._isValid = !this._modelEnabled || this._modelName.trim().length > 0;
  }


  /**
   * Get the current model name
   */
  public getModelName(): string {
    return this._modelName.trim();
  }

  /**
   * Get the current model enabled state
   */
  public getModelEnabled(): boolean {
    return this._modelEnabled;
  }

  /**
   * Check if the current input is valid
   */
  public isValid(): boolean {
    // Always compute validation based on current state
    // Valid if model is disabled OR if model is enabled and name is not empty
    return !this._modelEnabled || this._modelName.trim().length > 0;
  }

  /**
   * Get the dialog value - required by JupyterLab's showDialog function
   */
  public getValue(): IModelSelectionResult {
    try {
      console.log("ModelSelectionDialog.getValue() called!");
      return {
        modelName: this._modelName.trim(),
        modelEnabled: this._modelEnabled,
        cancelled: false
      };
    } catch (error) {
      console.error('Error in getValue:', error);
      return {
        modelName: '',
        modelEnabled: false,
        cancelled: true
      };
  }
  }

  private handleUpdate = (modelName: string, modelEnabled: boolean) => {
    this._modelName = modelName;
    this._modelEnabled = modelEnabled;
    // Valid if model is disabled OR if model is enabled and name is not empty
    this._isValid = !modelEnabled || modelName.trim().length > 0;
    
    // Force a re-render to ensure the dialog reflects the current state
    this.update();
  };

  private handleCancel = () => {
    // Reset to initial values on cancel
    this._modelName = this.initialModelName || '';
    this._modelEnabled = this.initialModelEnabled || false;
    this._isValid = !this._modelEnabled || this._modelName.trim().length > 0;
  };

  render(): JSX.Element {
    return (
      <ModelSelectionComponent
        initialModelName={this.initialModelName}
        initialModelEnabled={this.initialModelEnabled}
        onUpdate={this.handleUpdate}
      />
    );
  }
}

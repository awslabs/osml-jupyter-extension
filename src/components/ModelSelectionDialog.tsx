import React, { FC, useState } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
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
  // Use parent state as the single source of truth - controlled component
  const modelName = initialModelName;
  const modelEnabled = initialModelEnabled;

  const handleModelNameChange = (value: string) => {
    // Directly update the parent component
    onUpdate(value, modelEnabled);
  };

  const handleModelEnabledChange = (enabled: boolean) => {
    // Directly update the parent component
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

  constructor(private initialModelName?: string, private initialModelEnabled?: boolean) {
    super();
    this.addClass('jp-react-widget');
    this._modelName = initialModelName || '';
    this._modelEnabled = initialModelEnabled || false;
  }

  private handleUpdate = (modelName: string, modelEnabled: boolean) => {
    this._modelName = modelName;
    this._modelEnabled = modelEnabled;
    // Update the React component by re-rendering
    this.update();
  };

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
    return !this._modelEnabled || this._modelName.trim().length > 0;
  }

  /**
   * Get the dialog value - required by JupyterLab's showDialog function
   */
  public getValue(): IModelSelectionResult {
    try {
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

  render(): JSX.Element {
    return (
      <ModelSelectionComponent
        initialModelName={this._modelName}
        initialModelEnabled={this._modelEnabled}
        onUpdate={this.handleUpdate}
      />
    );
  }
}

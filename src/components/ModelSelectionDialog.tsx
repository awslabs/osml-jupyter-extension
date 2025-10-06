import React, { FC, useState, useEffect } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';
import Select from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import Spinner from '@cloudscape-design/components/spinner';
import { CommService } from '../services';
import { EndpointInfo, EndpointLoadingState } from '../types/models';

interface ModelSelectionComponentProps {
  initialModelName?: string;
  initialModelEnabled?: boolean;
  onUpdate: (modelName: string, modelEnabled: boolean) => void;
  commService?: CommService;
}

const ModelSelectionComponent: FC<ModelSelectionComponentProps> = ({
  initialModelName = '',
  initialModelEnabled = false,
  onUpdate,
  commService
}) => {
  // Use parent state as the single source of truth - controlled component
  const modelName = initialModelName;
  const modelEnabled = initialModelEnabled;
  
  // State for endpoint management
  const [endpointState, setEndpointState] = useState<EndpointLoadingState>({
    isLoading: false,
    error: undefined,
    endpoints: []
  });
  const [useManualEntry, setUseManualEntry] = useState(false);

  const fetchEndpoints = async () => {
    if (!commService) {
      setUseManualEntry(true);
      return;
    }

    setEndpointState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      const response = await commService.sendMessage({
        type: 'LIST_AVAILABLE_ENDPOINTS'
      });

      if (response.status === 'SUCCESS' && response.endpoints) {
        setEndpointState({
          isLoading: false,
          error: undefined,
          endpoints: response.endpoints,
          lastFetched: new Date()
        });
        setUseManualEntry(false);
      } else {
        throw new Error(response.error || 'Failed to fetch endpoints');
      }
    } catch (error) {
      console.warn('Failed to fetch endpoints, falling back to manual entry:', error);
      setEndpointState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch endpoints'
      }));
      setUseManualEntry(true);
    }
  };

  // Fetch endpoints on component mount
  useEffect(() => {
    if (commService && commService.isReady()) {
      fetchEndpoints();
    }
  }, [commService]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleModelNameChange = (value: string) => {
    onUpdate(value, modelEnabled);
  };

  const handleModelEnabledChange = (enabled: boolean) => {
    onUpdate(modelName, enabled);
  };

  const handleEndpointSelect = (selectedOption: any) => {
    if (selectedOption && selectedOption.value) {
      onUpdate(selectedOption.value, modelEnabled);
    }
  };

  const handleRefresh = () => {
    fetchEndpoints();
  };

  const handleSwitchToManual = () => {
    setUseManualEntry(true);
  };

  const handleSwitchToSelect = () => {
    setUseManualEntry(false);
  };

  // Validation: if model is enabled, name must not be empty
  const isModelNameValid = !modelEnabled || modelName.trim().length > 0;

  // Prepare endpoint options for Select component
  const endpointOptions = endpointState.endpoints.map(endpoint => ({
    label: `${endpoint.name} (${endpoint.status})`,
    value: endpoint.name,
    description: endpoint.instanceType || undefined
  }));

  const selectedEndpointOption = endpointOptions.find(option => option.value === modelName) || null;

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
        <SpaceBetween direction="vertical" size="m">
          {/* Error display */}
          {endpointState.error && !useManualEntry && (
            <Alert
              type="warning"
              header="Endpoint Loading Failed"
              action={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button onClick={handleRefresh} iconName="refresh">
                    Retry
                  </Button>
                  <Button onClick={handleSwitchToManual}>
                    Manual Entry
                  </Button>
                </SpaceBetween>
              }
            >
              {endpointState.error}
            </Alert>
          )}

          {/* Endpoint selection */}
          {!useManualEntry && !endpointState.error && (
            <FormField
              label="Endpoint Selection"
              description="Select from available SageMaker endpoints in your account"
              secondaryControl={
                !endpointState.isLoading && endpointState.endpoints.length > 0 ? (
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button 
                      onClick={handleRefresh} 
                      iconName="refresh"
                      loading={endpointState.isLoading}
                    >
                      Refresh
                    </Button>
                    <Button onClick={handleSwitchToManual}>
                      Manual Entry
                    </Button>
                  </SpaceBetween>
                ) : undefined
              }
            >
              {endpointState.isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Spinner size="normal" />
                  <span>Loading endpoints...</span>
                </div>
              ) : endpointState.endpoints.length === 0 ? (
                <Alert
                  type="info"
                  header="No Endpoints Available"
                  action={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button 
                        onClick={handleRefresh} 
                        iconName="refresh"
                      >
                        Refresh
                      </Button>
                      <Button onClick={handleSwitchToManual}>
                        Enter Manually
                      </Button>
                    </SpaceBetween>
                  }
                >
                  No SageMaker endpoints found in your account. You can enter an endpoint name manually.
                </Alert>
              ) : (
                <Select
                  selectedOption={selectedEndpointOption}
                  onChange={({ detail }) => handleEndpointSelect(detail.selectedOption)}
                  options={endpointOptions}
                  placeholder="Choose an endpoint"
                  filteringType="auto"
                  empty="No endpoints available"
                />
              )}
            </FormField>
          )}

          {/* Manual entry fallback */}
          {(useManualEntry || endpointState.error) && (
            <FormField
              label="Endpoint Name"
              description="Enter the identifier for the model endpoint you want to use"
              errorText={!isModelNameValid ? "Model endpoint name cannot be empty when model processing is enabled" : undefined}
              secondaryControl={
                !endpointState.error && endpointState.endpoints.length > 0 ? (
                  <Button onClick={handleSwitchToSelect}>
                    Select from List
                  </Button>
                ) : undefined
              }
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

  constructor(
    private initialModelName?: string, 
    private initialModelEnabled?: boolean,
    private commService?: CommService
  ) {
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
        commService={this.commService}
      />
    );
  }
}

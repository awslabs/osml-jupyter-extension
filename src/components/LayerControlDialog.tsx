import React, { FC, useState, useEffect } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
// @ts-ignore: react-color doesn't have perfect TypeScript support
import { CompactPicker } from 'react-color';
import { LayerInfo, LayerControlActions } from '../types';

interface LayerControlComponentProps {
  layers: LayerInfo[];
  actions: LayerControlActions;
  onClose: () => void;
}

/**
 * Utility function to convert RGBA array to hex color
 */
const rgbaToHex = (rgba: [number, number, number, number]): string => {
  const [r, g, b] = rgba;
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

/**
 * Utility function to convert hex color to RGBA array
 */
const hexToRgba = (hex: string, alpha: number = 255): [number, number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return [255, 0, 0, alpha]; // Default to red if parsing fails
  }
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
    alpha
  ];
};

/**
 * Generate a readable layer name from the layer ID
 */
const generateLayerName = (layerId: string, type: 'feature' | 'model'): string => {
  if (type === 'model') {
    return layerId.replace(/^model-/, ''); // Remove model- prefix
  }
  
  // For feature layers, extract filename from path
  const parts = layerId.split('/');
  const filename = parts[parts.length - 1];
  return filename || layerId;
};

const LayerControlComponent: FC<LayerControlComponentProps> = ({
  layers,
  actions,
  onClose
}) => {
  const [datasetName, setDatasetName] = useState('');
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);

  // Handle visibility toggle
  const handleVisibilityToggle = (layerId: string) => {
    actions.toggleVisibility(layerId);
  };

  // Handle color change from CompactPicker
  const handleColorChange = (layerId: string, color: any) => {
    const currentLayer = layers.find(layer => layer.id === layerId);
    if (!currentLayer) return;
    
    // Preserve the current alpha value
    const currentAlpha = currentLayer.color[3];
    const newRgba = hexToRgba(color.hex, currentAlpha);
    actions.updateColor(layerId, newRgba);
  };

  // Handle layer deletion
  const handleDelete = (layerId: string) => {
    actions.deleteLayer(layerId);
  };

  // Handle adding named dataset
  const handleAddDataset = () => {
    if (datasetName.trim()) {
      actions.addNamedDataset(datasetName.trim());
      setDatasetName(''); // Clear input after adding
    }
  };

  // Handle Enter key press in text input
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddDataset();
    }
  };

  // Handle backdrop click to close modal
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={handleBackdropClick}
    >
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
        maxWidth: '600px',
        maxHeight: '80vh',
        width: '90%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '2px solid #e9ecef',
          backgroundColor: '#f8f9fa',
          flexShrink: 0
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3 style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#333'
            }}>
              Layer Control
            </h3>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                padding: '0',
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#e9ecef';
                e.currentTarget.style.color = '#000';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#666';
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          backgroundColor: 'white'
        }}>
          {/* Add Named Dataset Section */}
          <div style={{
            padding: '20px',
            borderBottom: '1px solid #e9ecef'
          }}>
            <div style={{ 
              fontWeight: 'bold', 
              marginBottom: '12px', 
              fontSize: '16px',
              color: '#333'
            }}>
              Add Dataset Layer
            </div>
            <div style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center'
            }}>
              <input
                type="text"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter dataset name..."
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#d1d5db';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <button
                onClick={handleAddDataset}
                disabled={!datasetName.trim()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: datasetName.trim() ? '#3b82f6' : '#9ca3af',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: datasetName.trim() ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (datasetName.trim()) {
                    e.currentTarget.style.backgroundColor = '#2563eb';
                  }
                }}
                onMouseLeave={(e) => {
                  if (datasetName.trim()) {
                    e.currentTarget.style.backgroundColor = '#3b82f6';
                  }
                }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Active Layers Section */}
          <div style={{
            padding: '20px'
          }}>
            <div style={{ 
              fontWeight: 'bold', 
              marginBottom: '16px', 
              fontSize: '16px',
              color: '#333'
            }}>
              Active Layers ({layers.length})
            </div>
            
            {layers.length === 0 ? (
              <div style={{ 
                padding: '40px 20px',
                textAlign: 'center',
                color: '#666'
              }}>
                <div style={{ fontSize: '16px', marginBottom: '8px' }}>
                  No overlay layers
                </div>
                <div style={{ fontSize: '14px' }}>
                  Add dataset layers using the input above or "OversightML: Add Layer" from the file browser context menu.
                </div>
              </div>
            ) : (
              layers.map((layer) => (
                <div
                  key={layer.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: '1px solid #f3f4f6',
                    gap: '12px',
                    position: 'relative'
                  }}
                >
                  {/* Visibility Checkbox */}
                  <input
                    type="checkbox"
                    checked={layer.visible}
                    onChange={() => handleVisibilityToggle(layer.id)}
                    style={{
                      width: '18px',
                      height: '18px',
                      cursor: 'pointer'
                    }}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  />

                  {/* Layer Name */}
                  <div style={{ 
                    flex: 1,
                    minWidth: 0
                  }}>
                    <div style={{ 
                      fontWeight: '500', 
                      fontSize: '14px',
                      color: '#374151',
                      wordBreak: 'break-word'
                    }}>
                      {generateLayerName(layer.id, layer.type)}
                    </div>
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#6b7280',
                      marginTop: '2px'
                    }}>
                      {layer.type === 'model' ? 'Model Output' : 'Feature Layer'}
                    </div>
                  </div>

                  {/* Color Picker */}
                  <div style={{ position: 'relative' }}>
                    <div
                      onClick={() => setActiveColorPicker(
                        activeColorPicker === layer.id ? null : layer.id
                      )}
                      style={{
                        width: '32px',
                        height: '32px',
                        backgroundColor: rgbaToHex(layer.color),
                        border: '2px solid #e5e7eb',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'border-color 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#3b82f6';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#e5e7eb';
                      }}
                      title={`Change layer color (current: ${rgbaToHex(layer.color)})`}
                    />
                    
                    {activeColorPicker === layer.id && (
                      <div style={{
                        position: 'absolute',
                        top: '40px',
                        right: '0',
                        zIndex: 1000,
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
                        borderRadius: '8px',
                        overflow: 'hidden'
                      }}>
                        <CompactPicker
                          color={rgbaToHex(layer.color)}
                          onChange={(color) => handleColorChange(layer.id, color)}
                          onChangeComplete={() => setActiveColorPicker(null)}
                        />
                      </div>
                    )}
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={() => handleDelete(layer.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '18px',
                      padding: '6px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#dc2626'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#fef2f2';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    title="Delete layer"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default class LayerControlDialog extends ReactWidget {
  constructor(
    private layers: LayerInfo[],
    private actions: LayerControlActions,
    private onClose: () => void = () => {}
  ) {
    super();
    this.addClass('jp-react-widget');
  }

  /**
   * Update the layers and force a re-render
   */
  updateLayers(newLayers: LayerInfo[]): void {
    this.layers = newLayers;
    this.update();
  }

  render(): JSX.Element {
    return (
      <LayerControlComponent
        layers={this.layers}
        actions={this.actions}
        onClose={this.onClose}
      />
    );
  }
}

import React, { FC, useState, useEffect } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import { LayerInfo, LayerControlActions } from '../types';

interface LayerControlComponentProps {
  layers: LayerInfo[];
  actions: LayerControlActions;
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
  actions
}) => {
  // Handle visibility toggle
  const handleVisibilityToggle = (layerId: string) => {
    actions.toggleVisibility(layerId);
  };

  // Handle color change
  const handleColorChange = (layerId: string, newColor: string) => {
    const currentLayer = layers.find(layer => layer.id === layerId);
    if (!currentLayer) return;
    
    // Preserve the current alpha value
    const currentAlpha = currentLayer.color[3];
    const newRgba = hexToRgba(newColor, currentAlpha);
    actions.updateColor(layerId, newRgba);
  };

  // Handle layer deletion
  const handleDelete = (layerId: string) => {
    actions.deleteLayer(layerId);
  };

  if (layers.length === 0) {
    return (
      <div style={{ 
        padding: '16px',
        textAlign: 'center',
        color: '#666',
        backgroundColor: '#f8f9fa',
        border: '1px solid #dee2e6',
        borderRadius: '4px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>No Overlay Layers</div>
        <div style={{ fontSize: '14px' }}>
          Use "OversightML: Add Layer" from the file browser context menu to add overlay layers.
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%',
      maxHeight: '400px',
      overflow: 'auto'
    }}>
      {layers.map((layer) => (
        <div
          key={layer.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 12px',
            borderBottom: '1px solid #e9ecef',
            gap: '12px'
          }}
        >
          {/* Visibility Checkbox */}
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={() => handleVisibilityToggle(layer.id)}
            style={{
              width: '16px',
              height: '16px',
              cursor: 'pointer'
            }}
            title={layer.visible ? 'Hide layer' : 'Show layer'}
          />

          {/* Layer Name */}
          <div style={{ 
            flex: 1,
            minWidth: 0,
            wordBreak: 'break-word'
          }}>
            <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
              {generateLayerName(layer.id, layer.type)}
            </div>
          </div>

          {/* Color Picker */}
          <input
            type="color"
            value={rgbaToHex(layer.color)}
            onChange={(e) => handleColorChange(layer.id, e.target.value)}
            style={{
              width: '32px',
              height: '32px',
              border: '2px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              backgroundColor: 'transparent',
              padding: '0'
            }}
            title={`Change layer color (current: ${rgbaToHex(layer.color)})`}
          />

          {/* Delete Button */}
          <button
            onClick={() => handleDelete(layer.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f8f9fa';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Delete layer"
          >
            ❌
          </button>
        </div>
      ))}
    </div>
  );
};

export default class LayerControlDialog extends ReactWidget {
  constructor(
    private layers: LayerInfo[],
    private actions: LayerControlActions
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
      />
    );
  }
}

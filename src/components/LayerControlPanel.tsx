// Copyright Amazon.com, Inc. or its affiliates.

import React, { FC, useState } from 'react';
// @ts-ignore: react-color doesn't have perfect TypeScript support
import { CompactPicker } from 'react-color';
import { ILayerInfo, ILayerControlActions } from '../types';

interface ILayerControlPanelProps {
  layers: ILayerInfo[];
  actions: ILayerControlActions;
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
const hexToRgba = (
  hex: string,
  alpha: number = 255
): [number, number, number, number] => {
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
const generateLayerName = (
  layerId: string,
  type: 'feature' | 'model'
): string => {
  if (type === 'model') {
    return layerId.replace(/^model-/, ''); // Remove model- prefix
  }

  // For feature layers, extract filename from path
  const parts = layerId.split('/');
  const filename = parts[parts.length - 1];
  return filename || layerId;
};

const LayerControlPanel: FC<ILayerControlPanelProps> = ({
  layers,
  actions
}) => {
  const [datasetName, setDatasetName] = useState('');
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(
    null
  );

  // Handle visibility toggle
  const handleVisibilityToggle = (layerId: string) => {
    actions.toggleVisibility(layerId);
  };

  // Handle color change from CompactPicker
  const handleColorChange = (layerId: string, color: any) => {
    const currentLayer = layers.find(layer => layer.id === layerId);
    if (!currentLayer) {
      return;
    }

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

  return (
    <div>
      {/* Add Named Dataset Section */}
      <div
        style={{
          marginBottom: '16px',
          padding: '12px',
          border: '1px solid var(--jp-border-color1)',
          borderRadius: '4px',
          backgroundColor: 'var(--jp-layout-color1)'
        }}
      >
        <div
          style={{
            fontWeight: '600',
            marginBottom: '8px',
            fontSize: 'var(--jp-ui-font-size1)',
            color: 'var(--jp-ui-font-color1)'
          }}
        >
          Add Dataset Layer
        </div>
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center'
          }}
        >
          <input
            type="text"
            value={datasetName}
            onChange={e => setDatasetName(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter dataset name..."
            style={{
              flex: 1,
              padding: '6px 8px',
              border: '1px solid var(--jp-border-color1)',
              borderRadius: '3px',
              fontSize: 'var(--jp-ui-font-size1)',
              fontFamily: 'var(--jp-ui-font-family)',
              outline: 'none',
              backgroundColor: 'var(--jp-layout-color0)',
              color: 'var(--jp-ui-font-color1)',
              boxSizing: 'border-box'
            }}
          />
          <button
            onClick={handleAddDataset}
            disabled={!datasetName.trim()}
            style={{
              padding: '6px 12px',
              backgroundColor: datasetName.trim()
                ? 'var(--jp-brand-color1)'
                : 'var(--jp-layout-color3)',
              color: datasetName.trim() ? 'white' : 'var(--jp-ui-font-color2)',
              border: 'none',
              borderRadius: '3px',
              fontSize: 'var(--jp-ui-font-size1)',
              cursor: datasetName.trim() ? 'pointer' : 'not-allowed',
              fontWeight: '500'
            }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Active Layers Section */}
      <div>
        <div
          style={{
            fontWeight: '600',
            marginBottom: '12px',
            fontSize: 'var(--jp-ui-font-size1)',
            color: 'var(--jp-ui-font-color1)'
          }}
        >
          Active Layers ({layers.length})
        </div>

        {layers.length === 0 ? (
          <div
            style={{
              padding: '20px 12px',
              textAlign: 'center',
              color: 'var(--jp-ui-font-color2)',
              fontSize: 'var(--jp-ui-font-size1)',
              border: '1px solid var(--jp-border-color1)',
              borderRadius: '4px',
              backgroundColor: 'var(--jp-layout-color1)'
            }}
          >
            <div style={{ marginBottom: '4px' }}>No overlay layers</div>
            <div style={{ fontSize: 'var(--jp-ui-font-size0)' }}>
              Add dataset layers using the input above or "OversightML: Add
              Layer" from the file browser context menu.
            </div>
          </div>
        ) : (
          layers.map(layer => (
            <div
              key={layer.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid var(--jp-border-color2)',
                gap: '8px',
                position: 'relative'
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
              <div
                style={{
                  flex: 1,
                  minWidth: 0
                }}
              >
                <div
                  style={{
                    fontWeight: '500',
                    fontSize: 'var(--jp-ui-font-size1)',
                    color: 'var(--jp-ui-font-color1)',
                    wordBreak: 'break-word'
                  }}
                >
                  {generateLayerName(layer.id, layer.type)}
                </div>
                <div
                  style={{
                    fontSize: 'var(--jp-ui-font-size0)',
                    color: 'var(--jp-ui-font-color2)',
                    marginTop: '2px'
                  }}
                >
                  {layer.type === 'model' ? 'Model Output' : 'Feature Layer'}
                </div>
              </div>

              {/* Color Picker */}
              <div style={{ position: 'relative' }}>
                <div
                  onClick={() =>
                    setActiveColorPicker(
                      activeColorPicker === layer.id ? null : layer.id
                    )
                  }
                  style={{
                    width: '24px',
                    height: '24px',
                    backgroundColor: rgbaToHex(layer.color),
                    border: '1px solid var(--jp-border-color1)',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                  title={`Change layer color (current: ${rgbaToHex(layer.color)})`}
                />

                {activeColorPicker === layer.id && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '28px',
                      right: '0',
                      zIndex: 1000,
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}
                  >
                    <CompactPicker
                      color={rgbaToHex(layer.color)}
                      onChange={color => handleColorChange(layer.id, color)}
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
                  fontSize: '16px',
                  padding: '4px',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--jp-error-color1)',
                  width: '24px',
                  height: '24px'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor =
                    'var(--jp-error-color3)';
                }}
                onMouseLeave={e => {
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
  );
};

export default LayerControlPanel;

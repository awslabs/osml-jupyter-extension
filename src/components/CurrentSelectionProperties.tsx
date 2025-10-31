// Copyright Amazon.com, Inc. or its affiliates.

import React, { FC, useState, useMemo } from 'react';
// @ts-ignore: react-json-view doesn't have perfect TypeScript support
import ReactJson from 'react-json-view';
import { filterObjectBySearchTerm } from '../utils';

interface ICurrentSelection {
  type: 'location' | 'feature' | null;
  data?: any;
  imageCoordinates?: { x: number; y: number };
  worldCoordinates?: { latitude: number; longitude: number; elevation: number };
  coordinateError?: string;
  isLoadingCoordinates?: boolean;
}

interface ICurrentSelectionPropertiesProps {
  selection: ICurrentSelection;
}

/**
 * Component for displaying current selection properties including location coordinates and feature properties
 */
const CurrentSelectionProperties: FC<ICurrentSelectionPropertiesProps> = ({
  selection
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Filter feature properties based on search term
  const filteredProperties = useMemo(() => {
    if (selection.type !== 'feature' || !selection.data?.properties) {
      return {};
    }
    return filterObjectBySearchTerm(selection.data.properties, searchTerm);
  }, [selection, searchTerm]);

  if (!selection.type) {
    return (
      <div
        style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--jp-ui-font-color2)',
          fontSize: 'var(--jp-ui-font-size0)',
          fontStyle: 'italic'
        }}
      >
        Click on the map to view location information or click on a feature to
        view its properties
      </div>
    );
  }

  if (selection.type === 'location') {
    return (
      <div>
        {/* Image Coordinates */}
        <div style={{ marginBottom: '12px' }}>
          <h4
            style={{
              margin: '0 0 6px 0',
              fontSize: 'var(--jp-ui-font-size1)',
              fontWeight: '600',
              color: 'var(--jp-ui-font-color1)'
            }}
          >
            Image Coordinates
          </h4>
          <div
            style={{
              backgroundColor: 'var(--jp-layout-color2)',
              padding: '8px',
              borderRadius: '4px',
              fontFamily: 'var(--jp-code-font-family)',
              fontSize: 'var(--jp-code-font-size)',
              color: 'var(--jp-ui-font-color1)'
            }}
          >
            {selection.imageCoordinates
              ? `${selection.imageCoordinates.x.toFixed(2)}, ${selection.imageCoordinates.y.toFixed(2)}`
              : 'N/A'}
          </div>
        </div>

        {/* World Coordinates */}
        <div>
          <h4
            style={{
              margin: '0 0 6px 0',
              fontSize: 'var(--jp-ui-font-size1)',
              fontWeight: '600',
              color: 'var(--jp-ui-font-color1)'
            }}
          >
            World Coordinates
          </h4>
          <div
            style={{
              backgroundColor: 'var(--jp-layout-color2)',
              padding: '8px',
              borderRadius: '4px',
              fontFamily: 'var(--jp-code-font-family)',
              fontSize: 'var(--jp-code-font-size)',
              color: 'var(--jp-ui-font-color1)'
            }}
          >
            {selection.isLoadingCoordinates ? (
              <span
                style={{
                  color: 'var(--jp-ui-font-color2)',
                  fontStyle: 'italic'
                }}
              >
                Loading...
              </span>
            ) : selection.coordinateError ? (
              <span style={{ color: 'var(--jp-error-color1)' }}>
                Error: {selection.coordinateError}
              </span>
            ) : selection.worldCoordinates ? (
              `${selection.worldCoordinates.latitude.toFixed(6)}°, ${selection.worldCoordinates.longitude.toFixed(6)}°, ${selection.worldCoordinates.elevation.toFixed(2)}m`
            ) : (
              <span
                style={{
                  color: 'var(--jp-ui-font-color2)',
                  fontStyle: 'italic'
                }}
              >
                N/A
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (selection.type === 'feature') {
    const properties = selection.data?.properties || {};
    const hasProperties = Object.keys(properties).length > 0;
    const hasFilteredProperties = Object.keys(filteredProperties).length > 0;

    return (
      <div>
        {/* Search Input */}
        {hasProperties && (
          <div style={{ marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="Search properties..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid var(--jp-border-color1)',
                borderRadius: '4px',
                fontSize: 'var(--jp-ui-font-size0)',
                fontFamily: 'var(--jp-ui-font-family)',
                outline: 'none',
                backgroundColor: 'var(--jp-input-background)',
                color: 'var(--jp-ui-font-color1)',
                boxSizing: 'border-box'
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--jp-brand-color1)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--jp-border-color1)';
              }}
            />
            {searchTerm && (
              <div
                style={{
                  fontSize: 'var(--jp-ui-font-size0)',
                  color: 'var(--jp-ui-font-color2)',
                  marginTop: '4px'
                }}
              >
                {hasFilteredProperties
                  ? `Showing properties matching "${searchTerm}"`
                  : `No properties found matching "${searchTerm}"`}
              </div>
            )}
          </div>
        )}

        {/* Properties Display */}
        {!hasProperties ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--jp-ui-font-color2)',
              fontSize: 'var(--jp-ui-font-size0)',
              fontStyle: 'italic'
            }}
          >
            No properties available for this feature
          </div>
        ) : searchTerm && !hasFilteredProperties ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--jp-ui-font-color2)',
              fontSize: 'var(--jp-ui-font-size0)',
              fontStyle: 'italic'
            }}
          >
            No matching properties found
          </div>
        ) : (
          <ReactJson
            src={filteredProperties}
            name="properties"
            theme="rjv-default"
            collapsed={searchTerm ? false : 2}
            displayDataTypes={false}
            displayObjectSize={false}
            enableClipboard={true}
            indentWidth={2}
            iconStyle="triangle"
            style={{
              backgroundColor: 'transparent',
              fontSize: 'var(--jp-code-font-size)',
              fontFamily: 'var(--jp-code-font-family)'
            }}
            collapseStringsAfterLength={50}
            shouldCollapse={field => {
              if (searchTerm) {
                return false;
              }
              if (
                field.type === 'array' &&
                Array.isArray(field.src) &&
                field.src.length > 5
              ) {
                return true;
              }
              if (
                field.type === 'object' &&
                field.src &&
                typeof field.src === 'object' &&
                !Array.isArray(field.src) &&
                Object.keys(field.src).length > 10
              ) {
                return true;
              }
              return false;
            }}
          />
        )}
      </div>
    );
  }

  return null;
};

export default CurrentSelectionProperties;
export type { ICurrentSelection, ICurrentSelectionPropertiesProps };

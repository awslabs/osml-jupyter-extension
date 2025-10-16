// Copyright Amazon.com, Inc. or its affiliates.

import React, { FC, useState, useMemo } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
// @ts-ignore: react-json-view doesn't have perfect TypeScript support
import ReactJson from 'react-json-view';
import { filterObjectBySearchTerm } from '../utils';

interface IFeaturePropertiesComponentProps {
  feature: any;
  onClose: () => void;
}

/**
 * Main Feature Properties Component with Interactive JSON View
 */
const FeaturePropertiesComponent: FC<IFeaturePropertiesComponentProps> = ({
  feature,
  onClose
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const properties = feature?.properties || {};

  // Filter properties based on search term
  const filteredProperties = useMemo(() => {
    return filterObjectBySearchTerm(properties, searchTerm);
  }, [properties, searchTerm]);

  // Check if properties object is empty
  const hasProperties = Object.keys(properties).length > 0;
  const hasFilteredProperties = Object.keys(filteredProperties).length > 0;

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
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
          maxWidth: '800px',
          maxHeight: '80vh',
          width: '90%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '2px solid #e9ecef',
            backgroundColor: '#f8f9fa',
            flexShrink: 0
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: hasProperties ? '12px' : '0'
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#333'
              }}
            >
              Feature Properties
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
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = '#e9ecef';
                e.currentTarget.style.color = '#000';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#666';
              }}
            >
              ×
            </button>
          </div>

          {/* Search Input */}
          {hasProperties && (
            <div>
              <input
                type="text"
                placeholder="Search properties... (e.g., name, id, coordinates)"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxSizing: 'border-box'
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.boxShadow =
                    '0 0 0 3px rgba(59, 130, 246, 0.1)';
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = '#d1d5db';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              {searchTerm && (
                <div
                  style={{
                    fontSize: '12px',
                    color: '#666',
                    marginTop: '6px'
                  }}
                >
                  {hasFilteredProperties
                    ? `Showing filtered properties matching "${searchTerm}"`
                    : `No properties found matching "${searchTerm}"`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            backgroundColor: 'white',
            padding: hasProperties ? '20px' : '0'
          }}
        >
          {!hasProperties ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#666'
              }}
            >
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>
                No properties available
              </div>
              <div style={{ fontSize: '14px' }}>
                This feature doesn't have any associated properties.
              </div>
            </div>
          ) : searchTerm && !hasFilteredProperties ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#666'
              }}
            >
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>
                No matching properties found
              </div>
              <div style={{ fontSize: '14px' }}>
                Try adjusting your search term or clear the search to see all
                properties.
              </div>
            </div>
          ) : (
            <ReactJson
              src={filteredProperties}
              name="properties"
              theme="rjv-default"
              collapsed={searchTerm ? false : true} // Auto-expand when searching
              displayDataTypes={false}
              displayObjectSize={false}
              enableClipboard={true}
              indentWidth={2}
              iconStyle="triangle"
              style={{
                backgroundColor: 'transparent',
                fontSize: '14px',
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, monospace'
              }}
              collapseStringsAfterLength={100}
              shouldCollapse={field => {
                // When searching, don't auto-collapse to show results
                if (searchTerm) {
                  return false;
                }

                // Auto-collapse arrays with more than 10 items
                if (
                  field.type === 'array' &&
                  Array.isArray(field.src) &&
                  field.src.length > 10
                ) {
                  return true;
                }
                // Auto-collapse objects with more than 20 properties
                if (
                  field.type === 'object' &&
                  field.src &&
                  typeof field.src === 'object' &&
                  !Array.isArray(field.src) &&
                  Object.keys(field.src).length > 20
                ) {
                  return true;
                }
                return false;
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export class FeaturePropertiesDialog extends ReactWidget {
  constructor(
    private feature: any,
    private onClose: () => void
  ) {
    super();
    this.addClass('jp-react-widget');
  }

  render(): JSX.Element {
    return (
      <FeaturePropertiesComponent
        feature={this.feature}
        onClose={this.onClose}
      />
    );
  }
}

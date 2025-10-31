// Copyright Amazon.com, Inc. or its affiliates.

import React, { FC, useState, useMemo } from 'react';
// @ts-ignore: react-json-view doesn't have perfect TypeScript support
import ReactJson from 'react-json-view';
import { filterObjectBySearchTerm } from '../utils';
import { IMetadataObject } from '../types';

interface IImageInfo {
  name?: string;
  metadata?: IMetadataObject;
  isLoadingMetadata?: boolean;
  metadataError?: string;
}

interface IImagePropertiesProps {
  imageInfo: IImageInfo;
}

/**
 * Component for displaying image properties including name and metadata
 */
const ImageProperties: FC<IImagePropertiesProps> = ({ imageInfo }) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Filter metadata based on search term
  const filteredMetadata = useMemo(() => {
    if (!imageInfo.metadata) {
      return {};
    }
    return filterObjectBySearchTerm(imageInfo.metadata, searchTerm);
  }, [imageInfo.metadata, searchTerm]);

  const hasMetadata =
    imageInfo.metadata && Object.keys(imageInfo.metadata).length > 0;
  const hasFilteredMetadata = Object.keys(filteredMetadata).length > 0;

  if (!imageInfo.name) {
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
        No image loaded
      </div>
    );
  }

  return (
    <div>
      {/* Image Name */}
      <div style={{ marginBottom: '12px' }}>
        <h4
          style={{
            margin: '0 0 6px 0',
            fontSize: 'var(--jp-ui-font-size1)',
            fontWeight: '600',
            color: 'var(--jp-ui-font-color1)'
          }}
        >
          Image Name
        </h4>
        <div
          style={{
            backgroundColor: 'var(--jp-layout-color2)',
            padding: '8px',
            borderRadius: '4px',
            fontSize: 'var(--jp-ui-font-size0)',
            color: 'var(--jp-ui-font-color1)',
            wordBreak: 'break-all'
          }}
        >
          {imageInfo.name}
        </div>
      </div>

      {/* Metadata Section */}
      <div>
        <h4
          style={{
            margin: '0 0 6px 0',
            fontSize: 'var(--jp-ui-font-size1)',
            fontWeight: '600',
            color: 'var(--jp-ui-font-color1)'
          }}
        >
          Metadata
        </h4>

        {imageInfo.isLoadingMetadata ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--jp-ui-font-color2)',
              fontSize: 'var(--jp-ui-font-size0)'
            }}
          >
            Loading metadata...
          </div>
        ) : imageInfo.metadataError ? (
          <div
            style={{
              padding: '12px',
              backgroundColor: 'var(--jp-error-color3)',
              border: '1px solid var(--jp-error-color1)',
              borderRadius: '4px',
              color: 'var(--jp-error-color1)',
              fontSize: 'var(--jp-ui-font-size0)'
            }}
          >
            Error: {imageInfo.metadataError}
          </div>
        ) : !hasMetadata ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--jp-ui-font-color2)',
              fontSize: 'var(--jp-ui-font-size0)',
              fontStyle: 'italic'
            }}
          >
            No metadata available
          </div>
        ) : (
          <div>
            {/* Search Input */}
            <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="Search metadata..."
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
                  {hasFilteredMetadata
                    ? `Showing metadata matching "${searchTerm}"`
                    : `No metadata found matching "${searchTerm}"`}
                </div>
              )}
            </div>

            {/* Metadata Display */}
            {searchTerm && !hasFilteredMetadata ? (
              <div
                style={{
                  padding: '16px',
                  textAlign: 'center',
                  color: 'var(--jp-ui-font-color2)',
                  fontSize: 'var(--jp-ui-font-size0)',
                  fontStyle: 'italic'
                }}
              >
                No matching metadata found
              </div>
            ) : (
              <ReactJson
                src={filteredMetadata}
                name="metadata"
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
        )}
      </div>
    </div>
  );
};

export default ImageProperties;
export type { IImageInfo, IImagePropertiesProps };

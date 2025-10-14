// Copyright Amazon.com, Inc. or its affiliates.

import React, { FC, useState, useEffect, useMemo } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
// @ts-ignore: react-json-view doesn't have perfect TypeScript support
import ReactJson from 'react-json-view';
import { CommService } from '../services';
import { MetadataObject, MetadataValue } from '../types';
import { filterObjectBySearchTerm } from '../utils';

interface ImageMetadataComponentProps {
  imageName: string;
  commService?: CommService;
  onClose: () => void;
}

const ImageMetadataComponent: FC<ImageMetadataComponentProps> = ({
  imageName,
  commService,
  onClose
}) => {
  const [metadata, setMetadata] = useState<MetadataObject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch metadata on component mount
  useEffect(() => {
    const fetchMetadata = async () => {
      if (!commService || !commService.isReady()) {
        setError('Communication service not available');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(undefined);

        const response = await commService.sendMessage({
          type: 'IMAGE_METADATA_REQUEST',
          dataset: imageName
        });

        if (response.status === 'SUCCESS' && response.metadata) {
          setMetadata(response.metadata);
        } else {
          throw new Error(response.error || 'Failed to fetch metadata');
        }
      } catch (err) {
        console.error('Failed to fetch image metadata:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch metadata');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMetadata();
  }, [imageName, commService]);

  // Filter metadata based on search term
  const filteredMetadata = useMemo(() => {
    if (!metadata) return {};
    return filterObjectBySearchTerm(metadata, searchTerm);
  }, [metadata, searchTerm]);

  const hasMetadata = metadata && Object.keys(metadata).length > 0;
  const hasFilteredMetadata = Object.keys(filteredMetadata).length > 0;

  return (
    <div style={{
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
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
        maxWidth: '900px',
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
            alignItems: 'center',
            marginBottom: hasMetadata && !isLoading && !error ? '12px' : '0'
          }}>
            <h3 style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#333'
            }}>
              Image Metadata
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

          {/* Image Name and Search Input */}
          {hasMetadata && !isLoading && !error && (
            <div>
              <div style={{
                fontSize: '14px',
                color: '#666',
                marginBottom: '12px'
              }}>
                {imageName}
              </div>
              <input
                type="text"
                placeholder="Search metadata keys... (e.g., width, projection, bands)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
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
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#d1d5db';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              {searchTerm && (
                <div style={{
                  fontSize: '12px',
                  color: '#666',
                  marginTop: '6px'
                }}>
                  {hasFilteredMetadata 
                    ? `Showing filtered metadata matching "${searchTerm}"` 
                    : `No metadata found matching "${searchTerm}"`
                  }
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          backgroundColor: 'white',
          padding: hasMetadata && !isLoading && !error ? '20px' : '0'
        }}>
          {isLoading ? (
            <div style={{
              padding: '60px 20px',
              textAlign: 'center',
              color: '#666'
            }}>
              <div style={{
                display: 'inline-block',
                width: '40px',
                height: '40px',
                border: '3px solid #f3f3f3',
                borderTop: '3px solid #3b82f6',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: '16px'
              }}></div>
              <div style={{ fontSize: '16px' }}>
                Loading metadata for {imageName}...
              </div>
            </div>
          ) : error ? (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#dc2626',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              margin: '20px'
            }}>
              <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
                Failed to Load Metadata
              </div>
              <div style={{ fontSize: '14px' }}>
                {error}
              </div>
            </div>
          ) : !hasMetadata ? (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#666'
            }}>
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>
                No metadata available
              </div>
              <div style={{ fontSize: '14px' }}>
                No metadata found for image: {imageName}
              </div>
            </div>
          ) : searchTerm && !hasFilteredMetadata ? (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#666'
            }}>
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>
                No matching metadata found
              </div>
              <div style={{ fontSize: '14px' }}>
                Try adjusting your search term or clear the search to see all metadata.
              </div>
            </div>
          ) : (
            <ReactJson
              src={filteredMetadata}
              name="metadata"
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
              shouldCollapse={(field) => {
                // When searching, don't auto-collapse to show results
                if (searchTerm) return false;
                
                // Auto-collapse arrays with more than 10 items
                if (field.type === 'array' && Array.isArray(field.src) && field.src.length > 10) {
                  return true;
                }
                // Auto-collapse objects with more than 20 properties
                if (field.type === 'object' && field.src && typeof field.src === 'object' && !Array.isArray(field.src) && Object.keys(field.src).length > 20) {
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

export default class ImageMetadataDialog extends ReactWidget {
  constructor(
    private imageName: string,
    private commService?: CommService,
    private onClose: () => void = () => {}
  ) {
    super();
    this.addClass('jp-react-widget');
  }

  render(): JSX.Element {
    return (
      <ImageMetadataComponent
        imageName={this.imageName}
        commService={this.commService}
        onClose={this.onClose}
      />
    );
  }
}

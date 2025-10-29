// Copyright Amazon.com, Inc. or its affiliates.

import React, { FC } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';

interface ILocationInfoComponentProps {
  imageCoordinates: { x: number; y: number };
  worldCoordinates?: { latitude: number; longitude: number; elevation: number };
  error?: string;
  onClose: () => void;
}

/**
 * Main Coordinate Info Component
 */
const LocationInfoComponent: FC<ILocationInfoComponentProps> = ({
  imageCoordinates,
  worldCoordinates,
  error,
  onClose
}) => {
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
          maxWidth: '500px',
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
              alignItems: 'center'
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
              Location Information
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
        </div>

        {/* Content */}
        <div
          style={{
            padding: '20px',
            backgroundColor: 'white'
          }}
        >
          {/* Image Coordinates */}
          <div style={{ marginBottom: '20px' }}>
            <h4
              style={{
                margin: '0 0 8px 0',
                fontSize: '16px',
                fontWeight: '600',
                color: '#333'
              }}
            >
              Image Coordinates
            </h4>
            <div
              style={{
                backgroundColor: '#f8f9fa',
                padding: '12px',
                borderRadius: '6px',
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, monospace',
                fontSize: '14px'
              }}
            >
              <div>
                <span style={{ color: '#333' }}>
                  {imageCoordinates.x.toFixed(2)},{' '}
                  {imageCoordinates.y.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* World Coordinates */}
          <div>
            <h4
              style={{
                margin: '0 0 8px 0',
                fontSize: '16px',
                fontWeight: '600',
                color: '#333'
              }}
            >
              World Coordinates
            </h4>
            <div
              style={{
                backgroundColor: '#f8f9fa',
                padding: '12px',
                borderRadius: '6px',
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, monospace',
                fontSize: '14px'
              }}
            >
              {error ? (
                <div style={{ color: '#dc3545' }}>Error: {error}</div>
              ) : worldCoordinates ? (
                <div>
                  <span style={{ color: '#333' }}>
                    {worldCoordinates.latitude.toFixed(6)}°,{' '}
                    {worldCoordinates.longitude.toFixed(6)}°,{' '}
                    {worldCoordinates.elevation.toFixed(2)}m
                  </span>
                </div>
              ) : (
                <div style={{ color: '#666', fontStyle: 'italic' }}>
                  Loading...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export class LocationInfoDialog extends ReactWidget {
  constructor(
    private imageCoordinates: { x: number; y: number },
    private worldCoordinates?: {
      latitude: number;
      longitude: number;
      elevation: number;
    },
    private error?: string,
    private onClose: () => void = () => {}
  ) {
    super();
    this.addClass('jp-react-widget');
  }

  /**
   * Update the world coordinates after they are loaded
   */
  public updateWorldCoordinates(
    worldCoordinates?: {
      latitude: number;
      longitude: number;
      elevation: number;
    },
    error?: string
  ): void {
    this.worldCoordinates = worldCoordinates;
    this.error = error;
    this.update();
  }

  render(): JSX.Element {
    return (
      <LocationInfoComponent
        imageCoordinates={this.imageCoordinates}
        worldCoordinates={this.worldCoordinates}
        error={this.error}
        onClose={this.onClose}
      />
    );
  }
}

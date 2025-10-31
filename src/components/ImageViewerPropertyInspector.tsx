// Copyright Amazon.com, Inc. or its affiliates.

import React, { FC, useState } from 'react';
import ImageProperties, { IImageInfo } from './ImageProperties';
import CurrentSelectionProperties, {
  ICurrentSelection
} from './CurrentSelectionProperties';

interface IImageViewerPropertyInspectorProps {
  currentSelection: ICurrentSelection;
  imageInfo: IImageInfo;
}

/**
 * Expandable section component for consistent styling
 */
const ExpandableSection: FC<{
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultExpanded = true, children }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div style={{ marginBottom: '16px' }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          padding: '8px 12px',
          backgroundColor: 'var(--jp-layout-color2)',
          border: '1px solid var(--jp-border-color1)',
          borderRadius: '4px',
          fontSize: 'var(--jp-ui-font-size1)',
          fontWeight: '600',
          color: 'var(--jp-ui-font-color1)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left'
        }}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = 'var(--jp-layout-color3)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = 'var(--jp-layout-color2)';
        }}
      >
        <span>{title}</span>
        <span
          style={{
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            fontSize: '12px'
          }}
        >
          ▶
        </span>
      </button>
      {isExpanded && (
        <div
          style={{
            padding: '12px',
            border: '1px solid var(--jp-border-color1)',
            borderTop: 'none',
            borderRadius: '0 0 4px 4px',
            backgroundColor: 'var(--jp-layout-color0)'
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

/**
 * Main Image Viewer Property Inspector Component
 */
const ImageViewerPropertyInspector: FC<IImageViewerPropertyInspectorProps> = ({
  currentSelection,
  imageInfo
}) => {
  return (
    <div
      style={{
        padding: '12px',
        fontFamily: 'var(--jp-ui-font-family)',
        fontSize: 'var(--jp-ui-font-size1)',
        lineHeight: 'var(--jp-ui-font-lineheight)',
        backgroundColor: 'var(--jp-layout-color0)',
        color: 'var(--jp-ui-font-color1)',
        height: '100%',
        overflow: 'auto'
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h3
          style={{
            margin: '0 0 8px 0',
            color: 'var(--jp-ui-font-color1)',
            fontSize: 'var(--jp-ui-font-size2)',
            fontWeight: '600'
          }}
        >
          OSML Image Viewer
        </h3>
      </div>

      {/* Current Selection Section */}
      <ExpandableSection title="Current Selection" defaultExpanded={true}>
        <CurrentSelectionProperties selection={currentSelection} />
      </ExpandableSection>

      {/* Image Properties Section */}
      <ExpandableSection title="Image Properties" defaultExpanded={true}>
        <ImageProperties imageInfo={imageInfo} />
      </ExpandableSection>
    </div>
  );
};

export default ImageViewerPropertyInspector;
export type {
  ICurrentSelection,
  IImageInfo,
  IImageViewerPropertyInspectorProps
};

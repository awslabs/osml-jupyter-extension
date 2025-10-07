import React, { FC, useState, useEffect, useMemo } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Spinner from '@cloudscape-design/components/spinner';
import { CommService } from '../services';
import { MetadataObject, MetadataValue } from '../types';

interface MetadataRow {
  key: string;
  value: MetadataValue;
  flatKey: string; // For search purposes
}

interface ImageMetadataComponentProps {
  imageName: string;
  commService?: CommService;
}

/**
 * Utility function to flatten nested metadata for search indexing
 * Only includes leaf values, not intermediate object keys
 */
const flattenMetadata = (obj: MetadataObject, prefix = '', flatMap: Map<string, MetadataValue> = new Map()): Map<string, MetadataValue> => {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into objects but don't add the object key itself
      flattenMetadata(value as MetadataObject, fullKey, flatMap);
    } else {
      // Only add leaf values (non-object values)
      flatMap.set(fullKey, value);
    }
  }
  return flatMap;
};

/**
 * Utility function to convert metadata to table rows
 */
const metadataToRows = (metadata: MetadataObject): MetadataRow[] => {
  const rows: MetadataRow[] = [];
  const flatMap = flattenMetadata(metadata);
  
  for (const [flatKey, value] of flatMap.entries()) {
    rows.push({
      key: flatKey,
      value,
      flatKey: flatKey.toLowerCase() // For case-insensitive search
    });
  }
  
  return rows.sort((a, b) => a.key.localeCompare(b.key));
};

/**
 * Utility function to render metadata values appropriately
 */
const renderMetadataValue = (value: MetadataValue): string => {
  if (value === null || value === undefined) {
    return '(null)';
  }
  
  if (typeof value === 'boolean') {
    return value.toString();
  }
  
  if (typeof value === 'string' || typeof value === 'number') {
    return value.toString();
  }
  
  if (Array.isArray(value)) {
    // For arrays, show a compact representation
    if (value.length === 0) {
      return '[]';
    }
    
    // If all items are primitives, show them inline
    if (value.every(item => typeof item !== 'object' || item === null)) {
      return `[${value.map(item => {
        if (item === null) return 'null';
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          return item.toString();
        }
        return String(item);
      }).join(', ')}]`;
    }
    
    // For complex arrays, show count
    return `[Array of ${value.length} items]`;
  }
  
  if (typeof value === 'object') {
    const keys = Object.keys(value as MetadataObject);
    return `{Object with ${keys.length} properties}`;
  }
  
  return String(value);
};

const ImageMetadataComponent: FC<ImageMetadataComponentProps> = ({
  imageName,
  commService
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

  // Convert metadata to table rows and filter by search term
  const filteredRows = useMemo(() => {
    if (!metadata) return [];
    
    const rows = metadataToRows(metadata);
    
    if (!searchTerm) return rows;
    
    const searchLower = searchTerm.toLowerCase();
    return rows.filter(row => row.flatKey.includes(searchLower));
  }, [metadata, searchTerm]);

  const tableColumns = [
    {
      id: 'key',
      header: 'Key',
      cell: (item: MetadataRow) => (
        <div style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>
          {item.key}
        </div>
      ),
      sortingField: 'key',
      width: '40%'
    },
    {
      id: 'value',
      header: 'Value',
      cell: (item: MetadataRow) => (
        <div style={{ 
          wordBreak: 'break-word', 
          whiteSpace: 'pre-wrap',
          maxWidth: '100%',
          overflowWrap: 'anywhere'
        }}>
          {renderMetadataValue(item.value)}
        </div>
      ),
      width: '60%'
    }
  ];

  if (isLoading) {
    return (
      <SpaceBetween direction="vertical" size="l">
        <Box textAlign="center">
          <SpaceBetween direction="vertical" size="m">
            <Spinner size="large" />
            <Box variant="p">Loading metadata for {imageName}...</Box>
          </SpaceBetween>
        </Box>
      </SpaceBetween>
    );
  }

  if (error) {
    return (
      <SpaceBetween direction="vertical" size="l">
        <Alert type="error" header="Failed to Load Metadata">
          {error}
        </Alert>
      </SpaceBetween>
    );
  }

  if (!metadata || Object.keys(metadata).length === 0) {
    return (
      <SpaceBetween direction="vertical" size="l">
        <Alert type="info" header="No Metadata Available">
          No metadata found for image: {imageName}
        </Alert>
      </SpaceBetween>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
      <Box variant="p" color="text-body-secondary">
        {imageName}
      </Box>

      <FormField
        label="Search Keys"
        description="Search through metadata keys (case-insensitive)"
      >
        <Input
          value={searchTerm}
          onChange={({ detail }) => setSearchTerm(detail.value)}
          placeholder="e.g., width, projection, bands..."
          clearAriaLabel="Clear search"
          type="search"
        />
      </FormField>

      {searchTerm && (
        <Box variant="p" color="text-body-secondary">
          Showing {filteredRows.length} of {metadataToRows(metadata).length} entries
        </Box>
      )}
      
      <div style={{ 
        flex: 1,
        maxHeight: '400px', 
        overflowY: 'auto', 
        overflowX: 'hidden',
        border: '1px solid #e9ecef',
        borderRadius: '4px'
      }}>
        <Table
          columnDefinitions={tableColumns}
          items={filteredRows}
          sortingDisabled={false}
          empty={
            <Box textAlign="center" color="inherit">
              <SpaceBetween size="m">
                <b>No matching keys found</b>
                <Box variant="p" color="inherit">
                  Try adjusting your search term or clearing the search to see all metadata.
                </Box>
              </SpaceBetween>
            </Box>
          }
          variant="embedded"
        />
      </div>
    </div>
  );
};

export default class ImageMetadataDialog extends ReactWidget {
  constructor(
    private imageName: string,
    private commService?: CommService
  ) {
    super();
    this.addClass('jp-react-widget');
  }

  render(): JSX.Element {
    return (
      <ImageMetadataComponent
        imageName={this.imageName}
        commService={this.commService}
      />
    );
  }
}

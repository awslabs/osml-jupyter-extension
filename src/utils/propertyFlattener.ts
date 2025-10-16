// Copyright Amazon.com, Inc. or its affiliates.

/**
 * Utility functions for flattening nested objects in GeoJSON feature properties
 */

/**
 * Flattens a nested object into a flat object with dot notation keys
 * @param obj - The object to flatten
 * @param prefix - The prefix for keys (used recursively)
 * @returns Flattened object with string keys and string values
 */
export function flattenProperties(
  obj: any,
  prefix: string = ''
): Record<string, string> {
  const flattened: Record<string, string> = {};

  if (obj === null || obj === undefined) {
    return flattened;
  }

  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) {
      continue;
    }

    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      flattened[newKey] = 'null';
    } else if (typeof value === 'object') {
      if (Array.isArray(value)) {
        // Handle arrays - convert to readable string
        if (value.length === 0) {
          flattened[newKey] = '[]';
        } else if (value.every(item => typeof item !== 'object')) {
          // Simple array of primitives
          flattened[newKey] = `[${value.join(', ')}]`;
        } else {
          // Complex array - show length and first few items
          flattened[newKey] = `Array(${value.length}) [${value
            .slice(0, 3)
            .map(item =>
              typeof item === 'object' ? JSON.stringify(item) : String(item)
            )
            .join(', ')}${value.length > 3 ? '...' : ''}]`;
        }
      } else {
        // Nested object - recursively flatten
        const nested = flattenProperties(value, newKey);
        Object.assign(flattened, nested);
      }
    } else {
      // Primitive value - convert to string
      flattened[newKey] = String(value);
    }
  }

  return flattened;
}

/**
 * Formats a flattened properties object for display in a table
 * @param properties - The flattened properties object
 * @returns Array of key-value pairs suitable for table display
 */
export function formatPropertiesForTable(
  properties: Record<string, string>
): Array<{ key: string; value: string }> {
  return Object.entries(properties)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Creates HTML table content for feature properties
 * @param properties - The feature properties object
 * @returns HTML string for the table content
 */
export function createPropertyTableHTML(properties: any): string {
  const flattened = flattenProperties(properties);
  const formatted = formatPropertiesForTable(flattened);

  if (formatted.length === 0) {
    return '<tr><td colspan="2" style="text-align: center; font-style: italic;">No properties available</td></tr>';
  }

  return formatted
    .map(({ key, value }, index) => {
      // Escape HTML in values to prevent XSS
      const escapedKey = escapeHtml(key);
      const escapedValue = escapeHtml(value);

      // Handle long values with truncation and expand functionality
      const valueContent = createValueContent(escapedValue, index);

      return `<tr>
      <td class="property-key">${escapedKey}</td>
      <td class="property-value">${valueContent}</td>
    </tr>`;
    })
    .join('');
}

/**
 * Creates value content with truncation and expand functionality for long strings
 * @param value - The escaped value string
 * @param index - Unique index for this property
 * @returns HTML string for the value content
 */
function createValueContent(value: string, index: number): string {
  const MAX_DISPLAY_LENGTH = 100;
  const LONG_VALUE_THRESHOLD = 200;

  if (value.length <= MAX_DISPLAY_LENGTH) {
    // Short value - display normally with type detection
    return `<div class="value-content">${formatValueByType(value)}</div>`;
  }

  // Long value - create truncated version with expand/collapse
  const truncated = value.substring(0, MAX_DISPLAY_LENGTH);
  const remaining = value.substring(MAX_DISPLAY_LENGTH);
  const uniqueId = `prop-${index}`;

  if (value.length > LONG_VALUE_THRESHOLD) {
    // Very long value - use collapsible with summary
    return `<div class="value-content long-value">
      <div class="value-summary">
        <span class="value-type">${detectValueType(value)}</span>
        <span class="value-length">(${value.length} chars)</span>
      </div>
      <div class="value-preview">${formatValueByType(truncated)}</div>
      <button class="expand-btn" onclick="toggleValueExpansion('${uniqueId}', this)">
        <span class="expand-text">Show full value</span>
        <span class="collapse-text" style="display: none;">Show less</span>
      </button>
      <div id="${uniqueId}" class="value-full" style="display: none;">
        ${formatValueByType(value)}
      </div>
    </div>`;
  } else {
    // Moderately long value - simpler truncation
    return `<div class="value-content medium-value">
      <span class="value-truncated">${formatValueByType(truncated)}</span>
      <span id="${uniqueId}" class="value-remaining" style="display: none;">${formatValueByType(remaining)}</span>
      <button class="expand-btn-inline" onclick="toggleInlineExpansion('${uniqueId}', this)">...</button>
    </div>`;
  }
}

/**
 * Detects the type of value for better display formatting
 * @param value - The value string to analyze
 * @returns Type description string
 */
function detectValueType(value: string): string {
  // JSON detection
  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    try {
      JSON.parse(value);
      return 'JSON';
    } catch (e) {
      // Not valid JSON, continue with other checks
    }
  }

  // URL detection
  if (value.match(/^https?:\/\//)) {
    return 'URL';
  }

  // Coordinates detection (lat,lon or x,y patterns)
  if (value.match(/^-?\d+\.?\d*,-?\d+\.?\d*$/)) {
    return 'Coordinates';
  }

  // Base64 detection
  if (value.length > 50 && value.match(/^[A-Za-z0-9+/]+=*$/)) {
    return 'Base64';
  }

  // Number detection
  if (!isNaN(Number(value)) && value.trim() !== '') {
    return 'Number';
  }

  // Date detection
  if (
    value.match(/^\d{4}-\d{2}-\d{2}/) ||
    value.match(/^\d{2}\/\d{2}\/\d{4}/)
  ) {
    return 'Date';
  }

  return 'Text';
}

/**
 * Formats value based on its detected type
 * @param value - The value to format
 * @returns Formatted HTML string
 */
function formatValueByType(value: string): string {
  const type = detectValueType(value);

  switch (type) {
    case 'JSON':
      return `<code class="json-value">${value}</code>`;
    case 'URL':
      return `<a href="${value}" target="_blank" class="url-value">${value}</a>`;
    case 'Coordinates':
      return `<span class="coord-value">${value}</span>`;
    case 'Base64':
      return `<span class="base64-value" title="Base64 encoded data">${value}</span>`;
    case 'Number':
      // Format numbers with appropriate precision
      const num = Number(value);
      const formatted =
        num % 1 === 0 ? num.toString() : num.toFixed(6).replace(/\.?0+$/, '');
      return `<span class="number-value">${formatted}</span>`;
    case 'Date':
      return `<span class="date-value">${value}</span>`;
    default:
      return value;
  }
}

/**
 * Escapes HTML characters to prevent XSS
 * @param text - Text to escape
 * @returns Escaped text
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

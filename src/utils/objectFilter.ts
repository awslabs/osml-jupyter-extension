// Copyright Amazon.com, Inc. or its affiliates.

/**
 * Utility functions for filtering and flattening nested objects for search functionality
 */

export type FilterableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | FilterableValue[]
  | { [key: string]: FilterableValue };

/**
 * Flattens a nested object into a map of dot-notation keys to values
 * Only includes leaf values, not intermediate object keys
 * Now handles objects within arrays by using array indices in the key path
 */
export const flattenObject = (
  obj: { [key: string]: FilterableValue },
  prefix = '',
  flatMap: Map<string, FilterableValue> = new Map()
): Map<string, FilterableValue> => {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        // Handle arrays - recurse into objects within arrays
        value.forEach((arrayItem, index) => {
          const arrayKey = `${fullKey}.${index}`;
          if (
            arrayItem &&
            typeof arrayItem === 'object' &&
            !Array.isArray(arrayItem)
          ) {
            // Recurse into objects within the array
            flattenObject(
              arrayItem as { [key: string]: FilterableValue },
              arrayKey,
              flatMap
            );
          } else {
            // Add primitive values in arrays
            flatMap.set(arrayKey, arrayItem);
          }
        });
      } else {
        // Recurse into objects but don't add the object key itself
        flattenObject(
          value as { [key: string]: FilterableValue },
          fullKey,
          flatMap
        );
      }
    } else {
      // Only add leaf values (non-object values)
      flatMap.set(fullKey, value);
    }
  }
  return flatMap;
};

/**
 * Checks if an object contains any keys that match the search term
 */
export const objectContainsSearchTerm = (
  obj: { [key: string]: FilterableValue },
  searchTerm: string
): boolean => {
  if (!searchTerm.trim()) {
    return true;
  }

  const searchLower = searchTerm.toLowerCase();
  const flatMap = flattenObject(obj);

  for (const [key] of flatMap.entries()) {
    if (key.toLowerCase().includes(searchLower)) {
      return true;
    }
  }
  return false;
};

/**
 * Recursively filters an object to only include paths that contain the search term
 * Returns a new object with the same structure but only matching paths
 */
export const filterObjectBySearchTerm = (
  obj: { [key: string]: FilterableValue },
  searchTerm: string
): { [key: string]: FilterableValue } => {
  if (!searchTerm.trim()) {
    return obj;
  }

  const searchLower = searchTerm.toLowerCase();

  const shouldIncludePath = (path: string): boolean => {
    return path.toLowerCase().includes(searchLower);
  };

  const filterRecursively = (
    currentObj: { [key: string]: FilterableValue },
    currentPath = ''
  ): { [key: string]: FilterableValue } | null => {
    const filtered: { [key: string]: FilterableValue } = {};
    let hasMatches = false;

    for (const [key, value] of Object.entries(currentObj)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;

      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          // Handle arrays - filter objects within arrays
          const filteredArray: FilterableValue[] = [];
          let arrayHasMatches = false;

          value.forEach((arrayItem, index) => {
            const arrayPath = `${newPath}.${index}`;

            if (
              arrayItem &&
              typeof arrayItem === 'object' &&
              !Array.isArray(arrayItem)
            ) {
              // Recursively filter objects within the array
              const nestedResult = filterRecursively(
                arrayItem as { [key: string]: FilterableValue },
                arrayPath
              );
              if (nestedResult && Object.keys(nestedResult).length > 0) {
                filteredArray[index] = nestedResult;
                arrayHasMatches = true;
              } else if (shouldIncludePath(arrayPath)) {
                // Include the object even if empty if the path matches
                filteredArray[index] = arrayItem;
                arrayHasMatches = true;
              }
            } else {
              // For primitive values in arrays, check if the path matches
              if (shouldIncludePath(arrayPath)) {
                filteredArray[index] = arrayItem;
                arrayHasMatches = true;
              }
            }
          });

          if (arrayHasMatches || shouldIncludePath(newPath)) {
            filtered[key] = arrayHasMatches
              ? filteredArray.filter(item => item !== undefined)
              : value;
            hasMatches = true;
          }
        } else {
          // Recursively filter nested objects
          const nestedResult = filterRecursively(
            value as { [key: string]: FilterableValue },
            newPath
          );
          if (nestedResult && Object.keys(nestedResult).length > 0) {
            filtered[key] = nestedResult;
            hasMatches = true;
          } else if (shouldIncludePath(newPath)) {
            // Include the object even if empty if the path matches
            filtered[key] = value;
            hasMatches = true;
          }
        }
      } else {
        // For leaf values, check if the path matches
        if (shouldIncludePath(newPath)) {
          filtered[key] = value;
          hasMatches = true;
        }
      }
    }

    return hasMatches ? filtered : null;
  };

  const filteredResult = filterRecursively(obj);
  return filteredResult || {};
};

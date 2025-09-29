import { Kernel } from '@jupyterlab/services';
import { Feature, FeatureCollection } from 'geojson';

/**
 * Interface for tile information (matching ImagePyramidLayer)
 */
export interface IFeatureTile {
  x: number;
  y: number;
  z: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Type definition for feature tile data functions
 */
export type FeatureTileDataFunction = (tile: IFeatureTile) => Promise<Feature[]>;

/**
 * Create mock feature data for testing/debugging purposes.
 * Generates 5 square features per tile: 1 large at center, 4 smaller at corners.
 * 
 * @param tile Tile information
 * @param squareSize Size of the squares relative to tile size (default 0.1 = 10% of tile)
 */
export function createMockFeatureData(tile: IFeatureTile, squareSize: number = 0.1): Promise<Feature[]> {
  return new Promise((resolve) => {
    const features: Feature[] = [];
    
    const tileWidth = tile.right - tile.left;
    const tileHeight = tile.bottom - tile.top;
    const centerX = tile.left + tileWidth / 2;
    const centerY = tile.top + tileHeight / 2;
    
    // Large square at center (20% of tile size)
    const centerSquareSize = Math.min(tileWidth, tileHeight) * 0.2;
    const centerSquare = createSquareFeature(
      centerX, 
      centerY, 
      centerSquareSize,
      `center-${tile.x}-${tile.y}-${tile.z}`,
      { weight: 10, type: 'center' }
    );
    features.push(centerSquare);
    
    // Smaller squares at corners (10% of tile size)
    const cornerSquareSize = Math.min(tileWidth, tileHeight) * squareSize;
    const cornerOffset = cornerSquareSize / 2;
    
    // Top-left corner
    const topLeftSquare = createSquareFeature(
      tile.left + cornerOffset,
      tile.top + cornerOffset,
      cornerSquareSize,
      `corner-tl-${tile.x}-${tile.y}-${tile.z}`,
      { weight: 3, type: 'corner', position: 'top-left' }
    );
    features.push(topLeftSquare);
    
    // Top-right corner
    const topRightSquare = createSquareFeature(
      tile.right - cornerOffset,
      tile.top + cornerOffset,
      cornerSquareSize,
      `corner-tr-${tile.x}-${tile.y}-${tile.z}`,
      { weight: 3, type: 'corner', position: 'top-right' }
    );
    features.push(topRightSquare);
    
    // Bottom-left corner
    const bottomLeftSquare = createSquareFeature(
      tile.left + cornerOffset,
      tile.bottom - cornerOffset,
      cornerSquareSize,
      `corner-bl-${tile.x}-${tile.y}-${tile.z}`,
      { weight: 3, type: 'corner', position: 'bottom-left' }
    );
    features.push(bottomLeftSquare);
    
    // Bottom-right corner
    const bottomRightSquare = createSquareFeature(
      tile.right - cornerOffset,
      tile.bottom - cornerOffset,
      cornerSquareSize,
      `corner-br-${tile.x}-${tile.y}-${tile.z}`,
      { weight: 3, type: 'corner', position: 'bottom-right' }
    );
    features.push(bottomRightSquare);
    
    resolve(features);
  });
}

/**
 * Helper function to create a square feature with imageGeometry
 */
function createSquareFeature(
  centerX: number, 
  centerY: number, 
  size: number, 
  id: string,
  properties: any = {}
): Feature {
  const halfSize = size / 2;
  
  // Create square coordinates
  const coordinates = [[
    [centerX - halfSize, centerY - halfSize], // top-left
    [centerX + halfSize, centerY - halfSize], // top-right
    [centerX + halfSize, centerY + halfSize], // bottom-right
    [centerX - halfSize, centerY + halfSize], // bottom-left
    [centerX - halfSize, centerY - halfSize]  // close the polygon
  ]];
  
  const imageGeometry = {
    type: 'Polygon' as const,
    coordinates: coordinates
  };
  
  return {
    type: 'Feature',
    id: id,
    geometry: imageGeometry, // Standard GeoJSON geometry
    properties: {
      ...properties,
      imageGeometry: imageGeometry, // Also store in properties for compatibility
      centerX: centerX,
      centerY: centerY,
      size: size
    }
  };
}

/**
 * Load real feature data from the Jupyter kernel via comm channel.
 * 
 * @param tile Tile information
 * @param comm Jupyter comm channel
 * @param imageName Name of the image dataset
 * @param overlayName Name of the overlay dataset
 * @param timeout Timeout in milliseconds (default 10000)
 */
export function loadRealFeatureData(
  tile: IFeatureTile,
  comm: Kernel.IComm,
  imageName: string,
  overlayName: string,
  timeout: number = 10000
): Promise<Feature[]> {
  return new Promise((resolve, reject) => {
    const commFuture = comm.send({
      type: 'OVERLAY_TILE_REQUEST',
      imageName: imageName,
      overlayName: overlayName,
      zoom: tile.z,
      row: tile.y,
      col: tile.x
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout loading feature tile ${tile.x}-${tile.y}-${tile.z}`));
    }, timeout);

    commFuture.onIOPub = (msg: any): void => {
      const msgType = msg.header.msg_type;
      if (msgType === 'comm_msg') {
        const features = msg.content?.data?.features || [];
        
        // Process features to ensure they have proper imageGeometry
        const processedFeatures = features.map((feature: Feature) => {
          if (feature.properties?.imageGeometry) {
            // Use imageGeometry as the main geometry for rendering
            return {
              ...feature,
              geometry: feature.properties.imageGeometry
            };
          }
          return feature;
        });
        
        clearTimeout(timeoutId);
        resolve(processedFeatures);
      }
    };

    commFuture.done.catch(error => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

/**
 * Create a feature tile data function that uses mock data for testing.
 * 
 * @param squareSize Size of the corner squares relative to tile size (default 0.1)
 */
export function createMockFeatureDataFunction(squareSize: number = 0.1): FeatureTileDataFunction {
  return (tile: IFeatureTile): Promise<Feature[]> => {
    return createMockFeatureData(tile, squareSize);
  };
}

/**
 * Create a feature tile data function that loads real data from the kernel.
 * 
 * @param comm Jupyter comm channel
 * @param imageName Name of the image dataset
 * @param overlayName Name of the overlay dataset
 * @param timeout Timeout in milliseconds (default 10000)
 */
export function createRealFeatureDataFunction(
  comm: Kernel.IComm,
  imageName: string,
  overlayName: string,
  timeout: number = 10000
): FeatureTileDataFunction {
  return (tile: IFeatureTile): Promise<Feature[]> => {
    return loadRealFeatureData(tile, comm, imageName, overlayName, timeout);
  };
}

/**
 * Extract point positions from features for heatmap rendering.
 * Converts feature geometries to point coordinates with weights.
 */
export function extractHeatmapPoints(features: Feature[]): Array<{position: [number, number], weight: number}> {
  const points: Array<{position: [number, number], weight: number}> = [];
  
  features.forEach(feature => {
    const weight = feature.properties?.weight || 1;
    const geometry = feature.geometry || feature.properties?.imageGeometry;
    
    if (!geometry) {
      return;
    }
    
    switch (geometry.type) {
      case 'Point':
        points.push({
          position: [geometry.coordinates[0], geometry.coordinates[1]],
          weight: weight
        });
        break;
        
      case 'Polygon':
        // Use centroid of polygon
        const coords = geometry.coordinates[0]; // outer ring
        if (coords.length > 0) {
          const centroid = calculatePolygonCentroid(coords);
          points.push({
            position: centroid,
            weight: weight
          });
        }
        break;
        
      case 'LineString':
        // Use midpoint of line
        const lineCoords = geometry.coordinates;
        if (lineCoords.length > 0) {
          const midIndex = Math.floor(lineCoords.length / 2);
          points.push({
            position: [lineCoords[midIndex][0], lineCoords[midIndex][1]],
            weight: weight
          });
        }
        break;
    }
  });
  
  return points;
}

/**
 * Calculate the centroid of a polygon
 */
function calculatePolygonCentroid(coordinates: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  const numPoints = coordinates.length - 1; // Exclude the closing point
  
  for (let i = 0; i < numPoints; i++) {
    x += coordinates[i][0];
    y += coordinates[i][1];
  }
  
  return [x / numPoints, y / numPoints];
}

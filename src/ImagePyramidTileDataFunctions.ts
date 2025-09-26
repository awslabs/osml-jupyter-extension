import { Kernel } from '@jupyterlab/services';

/**
 * Interface for tile information (matching ImagePyramidLayer)
 */
export interface ITile {
  x: number;
  y: number;
  z: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  data?: string;
  loading?: boolean;
  error?: boolean;
}

/**
 * Type definition for tile data functions - all tile data functions should conform to this signature
 */
export type TileDataFunction = (tile: ITile) => Promise<string | null>;

/**
 * Create mock tile data for testing/debugging purposes.
 * Generates a canvas-based tile with gray background, border, and coordinate text.
 * 
 * @param tile Tile information
 * @param tileSize Tile size in pixels (default 512)
 * @param flipY Whether to apply flipY transformation for OrthographicView (default true)
 */
export function createMockTileData(tile: ITile, tileSize: number = 512): Promise<string | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      resolve(null);
      return;
    }

    // Save context state
    ctx.save();
    
    // Fill with gray background
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, tileSize, tileSize);
    
    // Add border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, tileSize - 2, tileSize - 2);
    
    // Add coordinates text
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${tile.x},${tile.y},${tile.z}`, tileSize / 2, tileSize / 2);
    
    // Restore context
    ctx.restore();
    
    resolve(canvas.toDataURL('image/png'));
  });
}

/**
 * Load real tile data from the Jupyter kernel via comm channel.
 * 
 * @param tile Tile information
 * @param comm Jupyter comm channel
 * @param imageName Name of the image dataset
 * @param timeout Timeout in milliseconds (default 10000)
 */
export function loadRealTileData(
  tile: ITile, 
  comm: Kernel.IComm, 
  imageName: string, 
  timeout: number = 10000
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const commFuture = comm.send({
      type: 'IMAGE_TILE_REQUEST',
      dataset: imageName,
      zoom: tile.z,
      row: tile.y,
      col: tile.x
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout loading tile ${tile.x}-${tile.y}-${tile.z}`));
    }, timeout);

    commFuture.onIOPub = (msg: any): void => {
      const msgType = msg.header.msg_type;
      if (msgType === 'comm_msg') {
        const base64Data = msg.content.data.img;
        const dataUrl = `data:image/png;base64,${base64Data}`;
        
        clearTimeout(timeoutId);
        resolve(dataUrl);
      }
    };

    commFuture.done.catch(error => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

/**
 * Create a getTileData function that uses mock data for testing.
 * This function conforms to the TileDataFunction signature and can be used interchangeably.
 * 
 * @param tileSize Tile size in pixels (default 512)
 * @param flipY Whether to apply flipY transformation (default true)
 */
export function createMockTileDataFunction(tileSize: number = 512): TileDataFunction {
  return (tile: ITile): Promise<string | null> => {
    return createMockTileData(tile, tileSize);
  };
}

/**
 * Create a getTileData function that loads real data from the kernel.
 * This function conforms to the TileDataFunction signature and can be used interchangeably.
 * 
 * @param comm Jupyter comm channel
 * @param imageName Name of the image dataset
 * @param timeout Timeout in milliseconds (default 10000)
 */
export function createRealTileDataFunction(
  comm: Kernel.IComm, 
  imageName: string, 
  timeout: number = 10000
): TileDataFunction {
  return (tile: ITile): Promise<string | null> => {
    return loadRealTileData(tile, comm, imageName, timeout);
  };
}

/**
 * Enhanced wrapper function that can work with any TileDataFunction.
 * This allows for easy swapping between mock and real tile data functions.
 * 
 * @param tileDataFunction The tile data function to wrap
 * @param updateCallback Optional callback to trigger when tiles are loaded
 */
export function createTileDataWrapper(
  tileDataFunction: TileDataFunction,
  updateCallback?: () => void
): TileDataFunction {
  return async (tile: ITile): Promise<string | null> => {
    try {
      const result = await tileDataFunction(tile);
      // Trigger update callback after tile data is loaded
      if (updateCallback) {
        setTimeout(() => {
          updateCallback();
        }, 0);
      }
      return result;
    } catch (error) {
      console.error(`Error loading tile ${tile.x}-${tile.y}-${tile.z}:`, error);
      return null;
    }
  };
}

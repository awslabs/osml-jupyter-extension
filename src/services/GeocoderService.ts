// Copyright Amazon.com, Inc. or its affiliates.

import {
  ParsedCoordinates,
  IPixelCoordinates,
  IWorldCoordinates,
  IGeocoderResult
} from '../types';
import { CommService } from './CommService';
import { logger } from '../utils';

/**
 * Service for handling coordinate-based navigation and geocoding
 */
export class GeocoderService {
  constructor(private commService: CommService) {}

  /**
   * Create a custom geocoder function for Deck.gl GeocoderWidget
   */
  public createCustomGeocoder(): (
    text: string,
    apiKey?: string
  ) => Promise<IGeocoderResult> {
    return async (text: string, apiKey?: string): Promise<IGeocoderResult> => {
      if (!text || text.trim() === '') {
        throw new Error('No coordinates provided');
      }

      const parsedCoordinates = this.parseCoordinateInput(text.trim());

      if (parsedCoordinates.type === 'unknown') {
        throw new Error(parsedCoordinates.error);
      }

      if (parsedCoordinates.type === 'pixel') {
        // For pixel coordinates, we need image dimensions to convert to view coordinates
        // This will be handled by the ImageViewerWidget which has access to image metadata
        return this.convertPixelToViewCoordinates(
          parsedCoordinates.x,
          parsedCoordinates.y
        );
      }

      if (parsedCoordinates.type === 'world') {
        // For world coordinates, we need to convert to image coordinates first
        const imageName = this.getCurrentImageName();
        if (!imageName) {
          throw new Error('No image loaded. Cannot convert world coordinates.');
        }

        const imageCoords = await this.convertWorldToImage(
          imageName,
          parsedCoordinates.latitude,
          parsedCoordinates.longitude,
          parsedCoordinates.elevation
        );

        return this.convertPixelToViewCoordinates(imageCoords.x, imageCoords.y);
      }

      throw new Error('Invalid coordinate type');
    };
  }

  /**
   * Parse coordinate input string and detect format
   */
  public parseCoordinateInput(text: string): ParsedCoordinates {
    const trimmed = text.trim();

    // Remove common separators and normalize
    const normalized = trimmed
      .replace(/[,;|]/g, ' ') // Replace separators with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Split into components
    const parts = normalized.split(' ').filter(part => part.length > 0);

    if (parts.length < 2) {
      return {
        type: 'unknown',
        raw: text,
        error: 'Coordinates must have at least two values (x,y or lat,lon)'
      };
    }

    // Try to parse as numbers
    const numbers = parts.map(part => {
      const num = parseFloat(part);
      return isNaN(num) ? null : num;
    });

    if (numbers.some(num => num === null)) {
      return {
        type: 'unknown',
        raw: text,
        error: 'All coordinate values must be valid numbers'
      };
    }

    const [first, second, third] = numbers as number[];

    // Determine if these are pixel coordinates (integers) or world coordinates (decimals)
    const isFirstInteger = Number.isInteger(first);
    const isSecondInteger = Number.isInteger(second);

    if (isFirstInteger && isSecondInteger) {
      // Both are integers - treat as pixel coordinates (x, y)
      return {
        type: 'pixel',
        raw: text,
        x: first,
        y: second
      } as IPixelCoordinates;
    } else {
      // At least one is decimal - treat as world coordinates (lat, lon)
      // Validate latitude and longitude ranges
      if (Math.abs(first) > 90) {
        // First value is likely longitude, second is latitude
        if (Math.abs(second) > 90) {
          return {
            type: 'unknown',
            raw: text,
            error: 'Latitude values must be between -90 and 90 degrees'
          };
        }
        return {
          type: 'world',
          raw: text,
          longitude: first,
          latitude: second,
          elevation: third || 0
        } as IWorldCoordinates;
      } else {
        // First value is likely latitude, second is longitude
        return {
          type: 'world',
          raw: text,
          latitude: first,
          longitude: second,
          elevation: third || 0
        } as IWorldCoordinates;
      }
    }
  }

  /**
   * Convert image coordinates to world coordinates using backend processor
   */
  public async convertImageToWorld(
    imageName: string,
    x: number,
    y: number
  ): Promise<{ latitude: number; longitude: number; elevation: number }> {
    if (!this.commService.isReady()) {
      const errorMessage = 'Communication service not ready';
      logger.error(
        `GeocoderService convertImageToWorld failed: ${errorMessage}`
      );
      throw new Error(errorMessage);
    }

    try {
      logger.debug(
        `Converting image coordinates to world coordinates: x=${x}, y=${y}`
      );

      const response = await this.commService.sendMessage({
        type: 'IMAGE_TO_WORLD_REQUEST',
        dataset: imageName,
        imageCoordinates: [[x, y]]
      });

      if (response.status !== 'SUCCESS') {
        const errorMessage = `Image to world conversion failed: ${response.status} - ${response.error || 'Unknown error'}`;
        logger.error(
          `GeocoderService convertImageToWorld failed: ${errorMessage}`
        );
        throw new Error(errorMessage);
      }

      if (
        !response.worldCoordinates ||
        response.worldCoordinates.length === 0
      ) {
        const errorMessage = 'No world coordinates returned from conversion';
        logger.error(
          `GeocoderService convertImageToWorld failed: ${errorMessage}`
        );
        throw new Error(errorMessage);
      }

      const [longitude, latitude, elevation] = response.worldCoordinates[0];
      logger.debug(
        `Image coordinates converted to world coordinates: lat=${latitude}, lon=${longitude}, elevation=${elevation}`
      );

      return { latitude, longitude, elevation };
    } catch (error: any) {
      logger.error(
        `GeocoderService convertImageToWorld failed: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Convert world coordinates to image coordinates using backend processor
   */
  public async convertWorldToImage(
    imageName: string,
    latitude: number,
    longitude: number,
    elevation: number = 0
  ): Promise<{ x: number; y: number }> {
    if (!this.commService.isReady()) {
      const errorMessage = 'Communication service not ready';
      logger.error(
        `GeocoderService convertWorldToImage failed: ${errorMessage}`
      );
      throw new Error(errorMessage);
    }

    try {
      logger.debug(
        `Converting world coordinates to image coordinates: lat=${latitude}, lon=${longitude}, elevation=${elevation}`
      );

      const response = await this.commService.sendMessage({
        type: 'WORLD_TO_IMAGE_REQUEST',
        dataset: imageName,
        worldCoordinates: [[longitude, latitude, elevation]]
      });

      if (response.status !== 'SUCCESS') {
        const errorMessage = `World to image conversion failed: ${response.status} - ${response.error || 'Unknown error'}`;
        logger.error(
          `GeocoderService convertWorldToImage failed: ${errorMessage}`
        );
        throw new Error(errorMessage);
      }

      if (
        !response.imageCoordinates ||
        response.imageCoordinates.length === 0
      ) {
        const errorMessage = 'No image coordinates returned from conversion';
        logger.error(
          `GeocoderService convertWorldToImage failed: ${errorMessage}`
        );
        throw new Error(errorMessage);
      }

      const [x, y] = response.imageCoordinates[0];
      logger.debug(
        `World coordinates converted to image coordinates: x=${x}, y=${y}`
      );

      return { x, y };
    } catch (error: any) {
      logger.error(
        `GeocoderService convertWorldToImage failed: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Convert pixel coordinates to view coordinates for Deck.gl
   * This is a placeholder - will be enhanced when integrated with ImageViewerWidget
   */
  public convertPixelToViewCoordinates(x: number, y: number): IGeocoderResult {
    // For orthographic view, the coordinates are typically 1:1 with image pixels
    // The exact conversion will depend on the current image dimensions and view state
    // This will be enhanced when integrated with ImageViewerWidget
    logger.debug(
      `Converting pixel coordinates to view coordinates: x=${x}, y=${y}`
    );

    return {
      longitude: x,
      latitude: y
    };
  }

  private currentImageName: string | null = null;
  private currentImageWidth: number = 0;
  private currentImageHeight: number = 0;

  /**
   * Get the current image name
   */
  private getCurrentImageName(): string | null {
    return this.currentImageName;
  }

  /**
   * Set current image context for coordinate conversion
   * This method will be called by ImageViewerWidget to provide context
   */
  public setImageContext(
    imageName: string,
    width: number,
    height: number
  ): void {
    this.currentImageName = imageName;
    this.currentImageWidth = width;
    this.currentImageHeight = height;
    logger.debug(
      `Setting image context: ${imageName}, dimensions: ${width}x${height}`
    );
  }

  /**
   * Dispose of the service and clean up resources
   */
  public dispose(): void {
    // Clean up any resources if needed
    logger.debug('GeocoderService disposed');
  }
}

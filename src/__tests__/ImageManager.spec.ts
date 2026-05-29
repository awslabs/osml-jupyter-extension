// Copyright Amazon.com, Inc. or its affiliates.

import { ImageManager } from '../services/ImageManager';
import {
  ImageTileService,
  IImageLoadResponse
} from '../services/ImageTileService';

jest.mock('../services/ImageTileService');
jest.mock('../utils', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock('@deck.gl/geo-layers', () => ({
  TileLayer: jest.fn().mockImplementation(props => ({
    id: props.id,
    props
  }))
}));

jest.mock('@deck.gl/layers', () => ({
  BitmapLayer: jest.fn()
}));

function createMockImageTileService(
  loadResponse: IImageLoadResponse
): ImageTileService {
  const mock = {
    loadImage: jest.fn().mockResolvedValue(loadResponse),
    loadImageMetadata: jest.fn().mockResolvedValue({
      success: true,
      metadata: {}
    }),
    createTileDataFunction: jest.fn().mockReturnValue(jest.fn())
  } as unknown as ImageTileService;
  return mock;
}

describe('ImageManager zoom restriction', () => {
  it('numLevels == 1 results in minZoom == 0', async () => {
    const service = createMockImageTileService({
      success: true,
      status: 'SUCCESS',
      width: 1024,
      height: 1024,
      numLevels: 1
    });
    const manager = new ImageManager(service);

    await manager.loadImage('/test.ntf');

    const viewState = manager.getInitialViewState();
    expect(viewState).not.toBeNull();
    expect(viewState!.minZoom).toEqual(0);
  });

  it('numLevels == 5 results in minZoom == -4', async () => {
    const service = createMockImageTileService({
      success: true,
      status: 'SUCCESS',
      width: 4096,
      height: 4096,
      numLevels: 5
    });
    const manager = new ImageManager(service);

    await manager.loadImage('/cog.tif');

    const viewState = manager.getInitialViewState();
    expect(viewState).not.toBeNull();
    expect(viewState!.minZoom).toBe(-4);
  });

  it('missing numLevels defaults to minZoom == 0', async () => {
    const service = createMockImageTileService({
      success: true,
      status: 'SUCCESS',
      width: 2048,
      height: 2048
    });
    const manager = new ImageManager(service);

    await manager.loadImage('/old-format.ntf');

    const viewState = manager.getInitialViewState();
    expect(viewState).not.toBeNull();
    expect(viewState!.minZoom).toEqual(0);
  });

  it('TileLayer is created with computed minZoom', async () => {
    const { TileLayer } = require('@deck.gl/geo-layers');
    const service = createMockImageTileService({
      success: true,
      status: 'SUCCESS',
      width: 2048,
      height: 2048,
      numLevels: 3
    });
    const manager = new ImageManager(service);

    await manager.loadImage('/image.tif');

    expect(TileLayer).toHaveBeenCalledWith(
      expect.objectContaining({ minZoom: -2 })
    );
  });

  it('image with many overviews allows deeper zoom-out', async () => {
    const service = createMockImageTileService({
      success: true,
      status: 'SUCCESS',
      width: 16384,
      height: 16384,
      numLevels: 8
    });
    const manager = new ImageManager(service);

    await manager.loadImage('/large-cog.tif');

    const viewState = manager.getInitialViewState();
    expect(viewState!.minZoom).toBe(-7);
  });
});

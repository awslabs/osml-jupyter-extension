// Copyright Amazon.com, Inc. or its affiliates.

jest.mock('../utils', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

// @jupyterlab/apputils pulls in an ESM-only web-components chain that Jest
// cannot transform; stub the base widget with a plain class carrying the
// members ImageViewerWidget touches.
jest.mock('@jupyterlab/apputils', () => ({
  MainAreaWidget: class {
    id = '';
    title: any = {};
    content: any = { node: { appendChild: jest.fn() } };
    constructor(_options?: any) {}
    dispose(): void {}
  },
  Toolbar: class {}
}));

// Deck.gl is WebGL-backed; stub the pieces the widget touches at construction.
jest.mock('@deck.gl/core', () => ({
  Deck: jest.fn().mockImplementation(() => ({
    setProps: jest.fn(),
    finalize: jest.fn(),
    getViewports: jest.fn()
  })),
  OrthographicView: jest.fn()
}));

import { ImageViewerWidget } from '../ImageViewerWidget';

/**
 * Build a mock ServiceContainer whose getServices() returns just enough for the
 * ImageViewerWidget constructor. Captures the CommService mock so tests can
 * assert on sendOneWay.
 */
function createServiceContainer() {
  const sendOneWay = jest.fn();
  const commService = { sendOneWay } as any;

  const layerManager = { layersChanged: { connect: jest.fn() } } as any;
  const imageManager = {
    imageChanged: { connect: jest.fn() },
    getCurrentImage: jest.fn(),
    getInitialViewState: jest.fn(),
    getImageLayer: jest.fn()
  } as any;
  const geocoderService = { connectToImageManager: jest.fn() } as any;

  const serviceContainer = {
    getServices: () => ({
      commService,
      layerManager,
      imageManager,
      geocoderService
    })
  } as any;

  return { serviceContainer, sendOneWay };
}

function createWidget() {
  const { serviceContainer, sendOneWay } = createServiceContainer();
  const widget = new ImageViewerWidget(serviceContainer);
  return { widget, sendOneWay };
}

describe('ImageViewerWidget state stream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('settle-debounce VIEW_STATE_UPDATE', () => {
    it('emits a single VIEW_STATE_UPDATE after the quiet period', () => {
      const { widget, sendOneWay } = createWidget();

      // Stand in for a loaded image and a deck viewport in image-pixel space.
      (widget as any).imageName = '/img.tif';
      (widget as any).deckInstance = {
        getViewports: () => [
          {
            width: 800,
            height: 600,
            zoom: 2,
            unproject: ([sx, sy]: number[]) => [sx, sy]
          }
        ]
      };

      // Rapid view changes: each call restarts the debounce timer.
      (widget as any).scheduleStateStreamUpdate();
      jest.advanceTimersByTime(100);
      (widget as any).scheduleStateStreamUpdate();
      jest.advanceTimersByTime(100);
      (widget as any).scheduleStateStreamUpdate();

      // Nothing emitted while the view keeps moving.
      expect(sendOneWay).not.toHaveBeenCalled();

      // After the quiet period, exactly one update fires.
      jest.advanceTimersByTime(300);

      expect(sendOneWay).toHaveBeenCalledTimes(1);
      expect(sendOneWay).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'VIEW_STATE_UPDATE',
          imageName: '/img.tif',
          minx: 0,
          miny: 0,
          maxx: 800,
          maxy: 600,
          zoom: 2
        })
      );
    });

    it('does not emit VIEW_STATE_UPDATE when no image is loaded', () => {
      const { widget, sendOneWay } = createWidget();

      (widget as any).imageName = undefined;
      (widget as any).scheduleStateStreamUpdate();
      jest.advanceTimersByTime(300);

      expect(sendOneWay).not.toHaveBeenCalled();
    });
  });

  describe('CLICK_EVENT emit', () => {
    it('emits image coords once for a background click', () => {
      const { widget, sendOneWay } = createWidget();
      (widget as any).imageName = '/img.tif';

      (widget as any).emitClickEvent({ coordinate: [12, 34] });

      expect(sendOneWay).toHaveBeenCalledTimes(1);
      expect(sendOneWay).toHaveBeenCalledWith({
        type: 'CLICK_EVENT',
        imageName: '/img.tif',
        x: 12,
        y: 34
      });
    });

    it('includes feature and layerId when a feature is hit', () => {
      const { widget, sendOneWay } = createWidget();
      (widget as any).imageName = '/img.tif';

      const feature = { properties: { id: 7 } };
      (widget as any).emitClickEvent({
        coordinate: [1, 2],
        object: feature,
        layer: { id: 'overlay-a' }
      });

      expect(sendOneWay).toHaveBeenCalledWith({
        type: 'CLICK_EVENT',
        imageName: '/img.tif',
        x: 1,
        y: 2,
        feature,
        layerId: 'overlay-a'
      });
    });

    it('does not emit when no image is loaded', () => {
      const { widget, sendOneWay } = createWidget();
      (widget as any).imageName = undefined;

      (widget as any).emitClickEvent({ coordinate: [1, 2] });

      expect(sendOneWay).not.toHaveBeenCalled();
    });

    it('does not emit when the click has no image coordinate', () => {
      const { widget, sendOneWay } = createWidget();
      (widget as any).imageName = '/img.tif';

      (widget as any).emitClickEvent({});

      expect(sendOneWay).not.toHaveBeenCalled();
    });
  });
});

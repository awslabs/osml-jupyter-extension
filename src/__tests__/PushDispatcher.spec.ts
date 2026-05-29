// Copyright Amazon.com, Inc. or its affiliates.

jest.mock('../utils', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

import { PushDispatcher } from '../services/PushDispatcher';
import {
  IFeatureDataFunctionFactory,
  ILayerRenderer,
  IPushMessage,
  IViewerNavigator
} from '../types';

function createNavigator(): jest.Mocked<IViewerNavigator> {
  return {
    navigateToCoordinates: jest.fn()
  };
}

function createLayerRenderer(): jest.Mocked<ILayerRenderer> {
  return {
    addFeatureLayer: jest.fn(),
    deleteLayer: jest.fn()
  };
}

function createFeatureDataFactory(): jest.Mocked<IFeatureDataFunctionFactory> {
  return {
    createFeatureDataFunction: jest.fn().mockReturnValue(jest.fn())
  };
}

function createDispatcher(
  overrides: {
    navigator?: jest.Mocked<IViewerNavigator>;
    layerRenderer?: jest.Mocked<ILayerRenderer>;
    featureDataFactory?: jest.Mocked<IFeatureDataFunctionFactory>;
    currentImageName?: string | undefined;
  } = {}
): {
  dispatcher: PushDispatcher;
  navigator: jest.Mocked<IViewerNavigator>;
  layerRenderer: jest.Mocked<ILayerRenderer>;
  featureDataFactory: jest.Mocked<IFeatureDataFunctionFactory>;
} {
  const navigator = overrides.navigator ?? createNavigator();
  const layerRenderer = overrides.layerRenderer ?? createLayerRenderer();
  const featureDataFactory =
    overrides.featureDataFactory ?? createFeatureDataFactory();
  const currentImageName =
    'currentImageName' in overrides
      ? overrides.currentImageName
      : 'current.tiff';
  const dispatcher = new PushDispatcher(
    navigator,
    layerRenderer,
    featureDataFactory,
    () => currentImageName
  );
  return { dispatcher, navigator, layerRenderer, featureDataFactory };
}

describe('PushDispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SET_VIEW / GOTO', () => {
    it('routes SET_VIEW to navigateToCoordinates with zoom', () => {
      const { dispatcher, navigator } = createDispatcher();

      dispatcher.dispatch({ type: 'SET_VIEW', x: 100, y: 200, zoom: 3 });

      expect(navigator.navigateToCoordinates).toHaveBeenCalledWith(100, 200, 3);
    });

    it('routes GOTO to navigateToCoordinates', () => {
      const { dispatcher, navigator } = createDispatcher();

      dispatcher.dispatch({ type: 'GOTO', x: 5, y: 6, zoom: 1 });

      expect(navigator.navigateToCoordinates).toHaveBeenCalledWith(5, 6, 1);
    });

    it('passes undefined zoom through when not provided', () => {
      const { dispatcher, navigator } = createDispatcher();

      dispatcher.dispatch({ type: 'SET_VIEW', x: 1, y: 2 });

      expect(navigator.navigateToCoordinates).toHaveBeenCalledWith(
        1,
        2,
        undefined
      );
    });

    it('drops SET_VIEW with missing numeric coordinates', () => {
      const { dispatcher, navigator } = createDispatcher();

      dispatcher.dispatch({ type: 'SET_VIEW', zoom: 3 } as IPushMessage);

      expect(navigator.navigateToCoordinates).not.toHaveBeenCalled();
    });
  });

  describe('ADD_LAYER', () => {
    it('wires a feature layer via the tile path using the pushed image name', () => {
      const { dispatcher, layerRenderer, featureDataFactory } =
        createDispatcher();
      const tileFn = jest.fn();
      featureDataFactory.createFeatureDataFunction.mockReturnValue(tileFn);

      dispatcher.dispatch({
        type: 'ADD_LAYER',
        name: 'detections',
        imageName: 'img.tiff'
      });

      expect(featureDataFactory.createFeatureDataFunction).toHaveBeenCalledWith(
        'img.tiff',
        'detections'
      );
      expect(layerRenderer.addFeatureLayer).toHaveBeenCalledWith(
        'detections',
        tileFn
      );
    });

    it('falls back to the current image name when the push omits it', () => {
      const { dispatcher, featureDataFactory } = createDispatcher({
        currentImageName: 'fallback.tiff'
      });

      dispatcher.dispatch({ type: 'ADD_LAYER', name: 'x' });

      expect(featureDataFactory.createFeatureDataFunction).toHaveBeenCalledWith(
        'fallback.tiff',
        'x'
      );
    });

    it('drops ADD_LAYER with no layer name', () => {
      const { dispatcher, layerRenderer } = createDispatcher();

      dispatcher.dispatch({ type: 'ADD_LAYER' } as IPushMessage);

      expect(layerRenderer.addFeatureLayer).not.toHaveBeenCalled();
    });

    it('drops ADD_LAYER when no image name can be resolved', () => {
      const { dispatcher, layerRenderer, featureDataFactory } =
        createDispatcher({ currentImageName: undefined });

      dispatcher.dispatch({ type: 'ADD_LAYER', name: 'x' });

      expect(
        featureDataFactory.createFeatureDataFunction
      ).not.toHaveBeenCalled();
      expect(layerRenderer.addFeatureLayer).not.toHaveBeenCalled();
    });
  });

  describe('REMOVE_LAYER', () => {
    it('routes REMOVE_LAYER to deleteLayer', () => {
      const { dispatcher, layerRenderer } = createDispatcher();

      dispatcher.dispatch({ type: 'REMOVE_LAYER', name: 'detections' });

      expect(layerRenderer.deleteLayer).toHaveBeenCalledWith('detections');
    });

    it('drops REMOVE_LAYER with no layer name', () => {
      const { dispatcher, layerRenderer } = createDispatcher();

      dispatcher.dispatch({ type: 'REMOVE_LAYER' } as IPushMessage);

      expect(layerRenderer.deleteLayer).not.toHaveBeenCalled();
    });
  });

  it('ignores unknown push types', () => {
    const { dispatcher, navigator, layerRenderer } = createDispatcher();

    dispatcher.dispatch({ type: 'SOMETHING_NEW' } as any);

    expect(navigator.navigateToCoordinates).not.toHaveBeenCalled();
    expect(layerRenderer.addFeatureLayer).not.toHaveBeenCalled();
    expect(layerRenderer.deleteLayer).not.toHaveBeenCalled();
  });
});

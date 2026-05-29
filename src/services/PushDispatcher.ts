// Copyright Amazon.com, Inc. or its affiliates.

import {
  IFeatureDataFunctionFactory,
  ILayerRenderer,
  IPushMessage,
  IViewerNavigator,
  PushMessageType
} from '../types';
import { logger } from '../utils';

/**
 * Routes kernel-initiated push messages (the "push channel") to the
 * appropriate frontend service. This keeps the transport (`CommService`, which
 * owns `comm.onMsg`) transport-only: the demultiplexer hands push-typed
 * messages here and this class owns the service wiring.
 *
 * Unknown push types are ignored, so future push verbs are additive.
 *
 * @remarks Handles the view-navigation verbs (`SET_VIEW` / `GOTO`) via the
 * navigator and the layer verbs (`ADD_LAYER` / `REMOVE_LAYER`) via the layer
 * renderer + feature-data-function factory. `ADD_LAYER` reuses the existing
 * tile path: the kernel has already indexed the features, so the dispatcher
 * only wires a `LayerManager` feature layer backed by an `OVERLAY_TILE_REQUEST`
 * data function.
 */
export class PushDispatcher {
  /**
   * @param navigator Viewer navigation surface for SET_VIEW / GOTO pushes.
   * @param layerRenderer Layer lifecycle surface for ADD_LAYER / REMOVE_LAYER.
   * @param featureDataFactory Builds the feature-tile data function ADD_LAYER
   *   wires into the rendered layer.
   * @param getCurrentImageName Resolves the current image name when an
   *   ADD_LAYER push omits `imageName`.
   */
  constructor(
    private navigator: IViewerNavigator,
    private layerRenderer: ILayerRenderer,
    private featureDataFactory: IFeatureDataFunctionFactory,
    private getCurrentImageName: () => string | undefined
  ) {}

  /**
   * Dispatch a single push message to the service responsible for its type.
   */
  public dispatch(message: IPushMessage): void {
    const type: PushMessageType = message.type;

    switch (type) {
      case 'SET_VIEW':
      case 'GOTO':
        this.handleSetView(message);
        break;
      case 'ADD_LAYER':
        this.handleAddLayer(message);
        break;
      case 'REMOVE_LAYER':
        this.handleRemoveLayer(message);
        break;
      default:
        logger.debug(`PushDispatcher ignoring unhandled push type: ${type}`);
        break;
    }
  }

  /**
   * Move the viewport to the pushed image-space coordinates (with real zoom).
   */
  private handleSetView(message: IPushMessage): void {
    const { x, y, zoom } = message;

    if (typeof x !== 'number' || typeof y !== 'number') {
      logger.error(
        `PushDispatcher ${message.type} missing numeric x/y; dropping push`
      );
      return;
    }

    this.navigator.navigateToCoordinates(x, y, zoom);
  }

  /**
   * Render a kernel-indexed layer. The features are already indexed under
   * `imageName:name` on the kernel, so this wires a feature layer whose tile
   * data streams back over `OVERLAY_TILE_REQUEST` — the same path the
   * right-click add-layer flow uses.
   */
  private handleAddLayer(message: IPushMessage): void {
    const { name } = message;

    if (!name) {
      logger.error(
        'PushDispatcher ADD_LAYER missing layer name; dropping push'
      );
      return;
    }

    const imageName = message.imageName ?? this.getCurrentImageName();
    if (!imageName) {
      logger.error(
        `PushDispatcher ADD_LAYER for '${name}' has no image name; dropping push`
      );
      return;
    }

    const getTileData = this.featureDataFactory.createFeatureDataFunction(
      imageName,
      name
    );
    this.layerRenderer.addFeatureLayer(name, getTileData);
    logger.info(`PushDispatcher rendered pushed layer: ${name}`);
  }

  /**
   * Remove a previously rendered layer.
   */
  private handleRemoveLayer(message: IPushMessage): void {
    const { name } = message;

    if (!name) {
      logger.error(
        'PushDispatcher REMOVE_LAYER missing layer name; dropping push'
      );
      return;
    }

    this.layerRenderer.deleteLayer(name);
    logger.info(`PushDispatcher removed pushed layer: ${name}`);
  }
}

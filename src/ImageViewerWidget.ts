// Copyright Amazon.com, Inc. or its affiliates.

import { MainAreaWidget, Toolbar } from '@jupyterlab/apputils';

import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import { Signal } from '@lumino/signaling';

import { Deck, OrthographicView } from '@deck.gl/core';

import {
  LayerManager,
  ImageManager,
  GeocoderService,
  CommService,
  ServiceContainer
} from './services';
import {
  ISelectionChangedArgs,
  IImageInfo,
  IViewerNavigator,
  IViewStateUpdateMessage,
  IClickEventMessage
} from './types';
import { logger } from './utils';

/**
 * Default settle-debounce delay (ms) before a settled view is streamed to the
 * kernel as a `VIEW_STATE_UPDATE`. Separate from the 100 ms tile throttle.
 */
const DEFAULT_SETTLE_DELAY_MS = 300;

/**
 * This widget provides a way to display geospatial information in a Jupyter environment overlaid on an image.
 */
export class ImageViewerWidget
  extends MainAreaWidget
  implements IViewerNavigator
{
  private mapDiv: HTMLDivElement;
  private deckInstance?: Deck;
  private imageName?: string;
  private viewportUpdateTimeout?: NodeJS.Timeout;
  private lastViewportUpdate: number = 0;

  /**
   * Live, widget-owned Deck.gl view state. Deck runs in *controlled* mode:
   * this field is the single source of truth for the camera. It is seeded in
   * `createDeckInstance`, echoed back on every `onViewStateChange` (required in
   * controlled mode or interaction freezes), and merged into by
   * `navigateToCoordinates`. Programmatic navigation must go through this field
   * rather than `initialViewState`, which Deck only applies when the *prop
   * value* changes and therefore silently drops repeat or post-interaction
   * targets.
   */
  private _viewState?: any;

  /**
   * Settle-debounce timer for the inbound state stream. Fires a single
   * `VIEW_STATE_UPDATE` after the view has been still for `settleDelayMs`.
   * Distinct from `viewportUpdateTimeout`, which keeps re-fetching tiles.
   */
  private settleTimeout?: NodeJS.Timeout;
  private readonly settleDelayMs: number = DEFAULT_SETTLE_DELAY_MS;

  // Service instances
  private layerManager: LayerManager;
  private imageManager: ImageManager;
  private geocoderService: GeocoderService;
  private commService: CommService;

  /**
   * Constructor for ImageViewerWidget.
   *
   * @param serviceContainer Pre-initialized service container with all dependencies
   */
  constructor(serviceContainer: ServiceContainer) {
    // Initialize the base class with a content area and toolbar
    const content = new Widget();
    const toolbar = new Toolbar();
    super({ content, toolbar });
    this.id = 'osml-jupyter-extension:image-viewer';
    this.title.label = 'OSML Image View';
    this.title.closable = true;

    // Get services from the container
    const services = serviceContainer.getServices();
    this.geocoderService = services.geocoderService;
    this.layerManager = services.layerManager;
    this.imageManager = services.imageManager;
    this.commService = services.commService;

    // Subscribe to LayerManager signals for layer changes
    this.layerManager.layersChanged.connect(() => {
      this.updateDeckLayers();
    });

    // Subscribe to ImageManager signals for image changes
    this.imageManager.imageChanged.connect(this.handleImageChanged, this);

    // Connect GeocoderService to ImageManager signal
    this.geocoderService.connectToImageManager(this.imageManager);

    // Create a new div that will contain the Deck.gl managed content. This div will be the full window in the
    // Jupyter tabbed panel.
    this.mapDiv = document.createElement('div');
    this.mapDiv.id = 'map-' + Date.now();
    this.mapDiv.style.width = '100%';
    this.mapDiv.style.height = '100%';
    this.mapDiv.style.backgroundColor = 'black';
    this.content.node.appendChild(this.mapDiv);
  }

  public readonly statusSignal: Signal<any, any> = new Signal<any, any>(this);
  public readonly selectionChanged: Signal<
    ImageViewerWidget,
    ISelectionChangedArgs
  > = new Signal<ImageViewerWidget, ISelectionChangedArgs>(this);
  public readonly selectionCleared: Signal<ImageViewerWidget, void> =
    new Signal<ImageViewerWidget, void>(this);

  /**
   * Handles click events on the map to emit selection signals
   */
  private handleMapClick(info: any, event: any): boolean {
    // Stream the click to the kernel-side ViewStateStore (image coords only,
    // one emit per click). This is independent of the property-inspector
    // selection signals below and does no world-coordinate math here.
    this.emitClickEvent(info);

    // Deck.gl picking associated an object with the click. Emit feature selection signal
    if (info.object && info.x !== undefined && info.y !== undefined) {
      this.selectionChanged.emit({
        type: 'feature',
        data: info.object,
        timestamp: Date.now()
      });
      return true; // Mark as handled
    }

    // If click was not associated with an object, emit location selection signal
    // Use coordinate from Deck.gl which gives us the world coordinates in the OrthographicView
    if (!info.object && info.coordinate) {
      const [x, y] = info.coordinate;

      // Emit initial location selection signal
      this.selectionChanged.emit({
        type: 'location',
        imageCoordinates: { x, y },
        isLoadingCoordinates: true,
        timestamp: Date.now()
      });

      // Asynchronously enrich with world coordinates
      if (this.imageName) {
        this.enrichLocationWithWorldCoordinates(x, y);
      }

      return true; // Mark as handled
    }

    // Click not handled - clear selection
    this.selectionCleared.emit();
    return false;
  }

  /**
   * Enrich location selection with world coordinates
   */
  private async enrichLocationWithWorldCoordinates(
    x: number,
    y: number
  ): Promise<void> {
    if (!this.imageName) {
      return;
    }

    try {
      const worldCoords = await this.geocoderService.convertImageToWorld(
        this.imageName,
        x,
        y
      );

      // Emit enriched selection signal
      this.selectionChanged.emit({
        type: 'location',
        imageCoordinates: { x, y },
        worldCoordinates: worldCoords,
        isLoadingCoordinates: false,
        timestamp: Date.now()
      });
    } catch (error: any) {
      // Emit error state
      this.selectionChanged.emit({
        type: 'location',
        imageCoordinates: { x, y },
        coordinateError: error.message,
        isLoadingCoordinates: false,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Emit a one-shot `CLICK_EVENT` to the kernel-side state stream. Sends the
   * click location in full-image pixel space (Deck.gl `info.coordinate`, which
   * is already image pixels under the `flipY` OrthographicView). When a feature
   * was picked, includes the raw feature object and its layer id.
   *
   * Fire-and-forget: no `*_RESPONSE` is awaited. Skips silently when no image
   * is loaded or the click has no image-space coordinate.
   */
  private emitClickEvent(info: any): void {
    if (!this.imageName || !info?.coordinate) {
      return;
    }

    const [x, y] = info.coordinate;

    const message: IClickEventMessage = {
      type: 'CLICK_EVENT',
      imageName: this.imageName,
      x,
      y
    };

    if (info.object) {
      message.feature = info.object;
      if (info.layer?.id !== undefined) {
        message.layerId = info.layer.id;
      }
    }

    this.commService.sendOneWay(message);
  }

  /**
   * Restart the settle-debounce timer for the inbound state stream. Called on
   * every `onViewStateChange`; the actual `VIEW_STATE_UPDATE` is emitted only
   * once the view has been still for `settleDelayMs`, so intermediate pan/zoom
   * frames are dropped. Independent of the 100 ms tile throttle.
   */
  private scheduleStateStreamUpdate(): void {
    if (this.settleTimeout) {
      clearTimeout(this.settleTimeout);
    }

    this.settleTimeout = setTimeout(() => {
      this.settleTimeout = undefined;
      this.emitViewStateUpdate();
    }, this.settleDelayMs);
  }

  /**
   * Emit a `VIEW_STATE_UPDATE` describing the settled view rectangle in
   * full-image pixel space plus zoom. Projects the four viewport corners into
   * image space via the Deck.gl viewport and sends their bounding rect.
   *
   * Fire-and-forget; skips silently when no image is loaded or the viewport is
   * not yet available.
   */
  private emitViewStateUpdate(): void {
    if (!this.imageName || !this.deckInstance) {
      return;
    }

    // The OrthographicView renders in full-image pixel coordinates, so the
    // viewport unprojects screen corners directly to image space.
    const viewports = (this.deckInstance as any).getViewports?.();
    const viewport = viewports && viewports[0];
    if (!viewport) {
      return;
    }

    try {
      const { width, height, zoom } = viewport;
      const corners = [
        viewport.unproject([0, 0]),
        viewport.unproject([width, 0]),
        viewport.unproject([width, height]),
        viewport.unproject([0, height])
      ];

      const xs = corners.map((c: number[]) => c[0]);
      const ys = corners.map((c: number[]) => c[1]);

      const message: IViewStateUpdateMessage = {
        type: 'VIEW_STATE_UPDATE',
        imageName: this.imageName,
        minx: Math.min(...xs),
        miny: Math.min(...ys),
        maxx: Math.max(...xs),
        maxy: Math.max(...ys),
        zoom: Array.isArray(zoom) ? zoom[0] : zoom
      };

      this.commService.sendOneWay(message);
    } catch (error: any) {
      logger.error(`Failed to emit VIEW_STATE_UPDATE: ${error.message}`);
    }
  }

  /**
   * Handle imageChanged signal from ImageManager
   */
  private handleImageChanged(
    sender: ImageManager,
    imageInfo: IImageInfo
  ): void {
    if (imageInfo.name) {
      // Image was loaded
      this.imageName = imageInfo.name;

      // Note: GeocoderService image context is now set automatically via its own signal connection

      // For deck instance creation, we need the basic image metadata
      // We can get this from the ImageManager
      const basicMetadata = this.imageManager.getCurrentImage();
      if (basicMetadata) {
        this.createDeckInstance(basicMetadata);
        this.updateDeckLayers();
      }

      this.statusSignal.emit(`${imageInfo.name} loaded successfully`);
      logger.info(`Image ${imageInfo.name} loaded successfully via signal.`);
    } else {
      // Image was cleared
      this.imageName = undefined;

      // Clean up deck instance
      if (this.deckInstance) {
        this.deckInstance.finalize();
        this.deckInstance = undefined;
      }

      // Clear the map div
      if (this.mapDiv) {
        this.mapDiv.innerHTML = '';
      }

      this.statusSignal.emit('Image cleared');
      logger.info('Image cleared via signal.');
    }
  }

  /**
   * Create Deck.gl instance with the loaded image
   */
  private createDeckInstance(imageMetadata: any): void {
    // Get the initial viewport state from ImageManager
    const initialViewState = this.imageManager.getInitialViewState();
    if (!initialViewState) {
      console.error('Could not get initial view state from ImageManager');
      return;
    }

    // Seed the widget-owned view state. Deck runs in controlled mode from here
    // on, so this field — not `initialViewState` — drives the camera.
    this._viewState = { ...(initialViewState as any) };

    // Create a canvas element for Deck.gl
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.backgroundColor = 'black'; // Set canvas background to black
    this.mapDiv.appendChild(canvas);

    // Get the image layer from ImageManager
    const imageLayer = this.imageManager.getImageLayer();
    if (!imageLayer) {
      console.error('Could not get image layer from ImageManager');
      return;
    }

    this.deckInstance = new Deck({
      canvas: canvas,
      width: '100%',
      height: '100%',
      viewState: this._viewState,
      views: [
        new OrthographicView({
          id: 'ortho',
          controller: true,
          flipY: true // Assign 0,0 to the upper left corner to match image coordinate systems
        })
      ],
      layers: [imageLayer],
      widgets: [],
      parameters: {
        clearColor: [0, 0, 0, 1] // Black background (RGBA: 0, 0, 0, 1)
      } as any, // Type assertion to work around Deck.gl typing issues
      onViewStateChange: ({ viewState }) => {
        // Controlled mode: adopt the interaction-driven view state as the new
        // source of truth and echo it back, otherwise pan/zoom would freeze.
        this._viewState = viewState;
        this.deckInstance?.setProps({ viewState: this._viewState });
        // Use throttled update to prevent excessive layer updates during rapid viewport changes
        this.throttledViewportUpdate();
        // Separately, stream the settled view to the kernel once the user stops
        // interacting (settle-debounce), so the ViewStateStore learns the bounds
        // once rather than per pan frame.
        this.scheduleStateStreamUpdate();
      },
      onClick: (info: any, event: any) => {
        return this.handleMapClick(info, event);
      }
    }) as any; // Type assertion to work around Deck.gl typing issues
  }

  /**
   * Throttled viewport update to prevent excessive layer updates during rapid viewport changes.
   * This ensures smooth interaction while still updating tiles when the viewport stabilizes.
   */
  private throttledViewportUpdate(): void {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastViewportUpdate;

    // Clear any existing timeout
    if (this.viewportUpdateTimeout) {
      clearTimeout(this.viewportUpdateTimeout);
    }

    // If enough time has passed since the last update, update immediately
    if (timeSinceLastUpdate >= 100) {
      // 100ms throttle
      this.lastViewportUpdate = now;
      this.updateDeckLayers();
    } else {
      // Otherwise, schedule an update for later
      this.viewportUpdateTimeout = setTimeout(() => {
        this.lastViewportUpdate = Date.now();
        this.updateDeckLayers();
      }, 100 - timeSinceLastUpdate);
    }
  }

  /**
   * Updates the Deck.gl instance with current layers.
   */
  private updateDeckLayers(): void {
    if (!this.deckInstance) {
      return;
    }

    // Get the image layer from ImageManager
    const imageLayer = this.imageManager.getImageLayer();
    const allLayers = this.layerManager.getAllVisibleLayers();

    // Combine layers, only include image layer if it exists
    const layers = imageLayer ? [imageLayer, ...allLayers] : allLayers;

    this.deckInstance.setProps({
      layers: layers
    });
  }

  /**
   * Handler triggered when a user closes the main area window containing this widget. Implementation expands on the
   * super's implementation to ensure class specific resources are cleaned up.
   *
   * @param msg the lumino message
   * @protected
   */
  protected onCloseRequest(msg: Message): void {
    super.onCloseRequest(msg);
    this.dispose();
  }

  /**
   * Navigate to specific coordinates by updating the view state.
   *
   * @param x target x (image-space) coordinate
   * @param y target y (image-space) coordinate
   * @param zoom optional target zoom; when omitted the current zoom is kept
   */
  public navigateToCoordinates(x: number, y: number, zoom?: number): void {
    if (!this.deckInstance) {
      logger.error('Cannot navigate: Deck instance not available');
      return;
    }

    try {
      // Resolve the target zoom: use the requested zoom when provided,
      // otherwise preserve the current view state's zoom.
      const targetZoom = zoom ?? this._viewState?.zoom ?? 0;

      // Merge the target into the widget-owned (controlled) view state. Because
      // this is applied relative to the live camera — not diffed against a
      // stale `initialViewState` — Deck always honors the move, even for a
      // repeat target or after manual pan/zoom.
      this._viewState = {
        ...this._viewState,
        target: [x, y, 0],
        zoom: targetZoom,
        transitionDuration: 500
      };

      // Update the view state using setProps
      this.deckInstance.setProps({
        viewState: this._viewState
      });

      this.statusSignal.emit(
        `Navigated to coordinates: ${x.toFixed(2)}, ${y.toFixed(2)}`
      );
      logger.info(`Navigation successful: x=${x}, y=${y}, zoom=${targetZoom}`);
    } catch (error: any) {
      logger.error(`Navigation failed: ${error.message}`);
      this.statusSignal.emit(`Navigation failed: ${error.message}`);
    }
  }

  /**
   * Implementation expand the super's dispose function to ensure class specific resources are cleaned up.
   * Services are managed by the ServiceContainer and should not be disposed here.
   */
  dispose(): void {
    // Clean up viewport update timeout
    if (this.viewportUpdateTimeout) {
      clearTimeout(this.viewportUpdateTimeout);
      this.viewportUpdateTimeout = undefined;
    }

    // Clean up settle-debounce timeout for the inbound state stream
    if (this.settleTimeout) {
      clearTimeout(this.settleTimeout);
      this.settleTimeout = undefined;
    }

    // Clean up Deck.gl instance
    if (this.deckInstance) {
      this.deckInstance.finalize();
      this.deckInstance = undefined;
    }

    // Clean up DOM
    if (this.mapDiv) {
      this.mapDiv.innerHTML = '';
    }

    super.dispose();
  }
}

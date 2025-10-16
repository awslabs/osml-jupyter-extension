// Copyright Amazon.com, Inc. or its affiliates.

import {
  ISessionContext,
  SessionContext,
  SessionContextDialogs
} from '@jupyterlab/apputils';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { Kernel, KernelMessage, ServiceManager } from '@jupyterlab/services';

import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import { Signal } from '@lumino/signaling';
import { MainAreaWidget, Toolbar } from '@jupyterlab/apputils';
import { Deck, OrthographicView } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

import { KERNEL_SETUP_CODE, createPropertyTableHTML } from './utils';
import { ITile, TileDataFunction, FeatureTileDataFunction } from './types';
import { TiledOverlayLayer } from './layers';
import {
  CommService,
  ImageTileService,
  FeatureTileService,
  KernelService
} from './services';
import {
  LayerControlToolbarButton,
  FeaturePropertiesDialog
} from './components';
import { ReactWidget } from '@jupyterlab/ui-components';
import React from 'react';

/**
 * This widget provides a way to display geospatial information in a Jupyter environment overlaid on an image.
 */
export class ImageViewerWidget extends MainAreaWidget {
  private imageSessionContext?: SessionContext;
  private sessionContextDialogs: SessionContextDialogs;
  private translator: ITranslator;
  private mapDiv: HTMLDivElement;
  private deckInstance?: Deck;
  private featureLayers: Map<string, TiledOverlayLayer> = new Map();
  private modelLayers: Map<string, TiledOverlayLayer> = new Map();
  private comm?: Kernel.IComm;
  private imageName?: string;
  private manager?: ServiceManager.IManager;
  private viewportUpdateTimeout?: NodeJS.Timeout;
  private lastViewportUpdate: number = 0;

  // Feature properties dialog state
  private featurePropertiesDialog?: ReactWidget;
  private featurePropertiesDialogVisible: boolean = false;

  // Service instances
  private commService: CommService;
  private imageTileService: ImageTileService;
  private featureTileService: FeatureTileService;
  private kernelService: KernelService;

  // Configuration options
  private useMockData: boolean = false; // Set to true for testing with mock tiles
  private useMockFeatureData: boolean = false; // Set to true for testing with mock features
  private enableDebugLogging: boolean = false;

  // Layer implementation selection (always use TiledOverlayLayer)
  private useTiledOverlayLayer: boolean = true; // Always true - using TiledOverlayLayer

  // Model selection state
  private selectedModel: string = '';
  private selectedModelEnabled: boolean = false;

  // Layer management state
  private layerVisibility: Map<string, boolean> = new Map();
  private layerColors: Map<string, [number, number, number, number]> =
    new Map();
  private layerControlButton?: LayerControlToolbarButton;

  /**
   * Static Factory Method for the ImageViewerWidget.
   *
   * On creation this widget injects code into a Python Kernel that establishes the server side of a "comm" channel
   * and sets up tile readers / vector indexes based on the osml-imagery-toolkit. These resources will be accessed
   * by custom messages sent by layers added to the map.
   *
   * @param manager Jupyter service manager dependency
   * @param selectedFileName Path of the selected file on the local file system
   */
  public static async createForImage(
    manager: ServiceManager.IManager,
    selectedFileName: string | null
  ): Promise<ImageViewerWidget> {
    const widget = new ImageViewerWidget(manager);
    await widget.initialize(selectedFileName);
    return widget;
  }

  public constructor(manager: ServiceManager.IManager) {
    const content = new Widget();
    const toolbar = new Toolbar();
    super({ content, toolbar });
    this.id = 'osml-jupyter-extension:image-viewer';
    this.title.label = 'OSML Image View';
    this.title.closable = true;

    this.manager = manager;

    this.translator = nullTranslator;

    // Initialize services (will be properly initialized after kernel setup)
    this.commService = new CommService();
    this.imageTileService = new ImageTileService(this.commService, {
      enableDebugLogging: this.enableDebugLogging
    });
    this.featureTileService = new FeatureTileService(this.commService);
    this.kernelService = new KernelService(this.manager);

    // Create a new session to connect to the Jupyter Kernel that will be providing the image tiles.
    this.imageSessionContext = new SessionContext({
      sessionManager: this.manager.sessions,
      specsManager: this.manager.kernelspecs,
      name: 'OversightML Image Viewer',
      kernelPreference: { name: 'ipython' }
    });

    this.sessionContextDialogs = new SessionContextDialogs({
      translator: this.translator
    });

    // Create a new div that will contain the Deck.gl managed content. This div will be the full window in the
    // Jupyter tabbed panel.
    this.mapDiv = document.createElement('div');
    this.mapDiv.id = 'map-' + Date.now();
    this.mapDiv.style.width = '100%';
    this.mapDiv.style.height = '100%';
    this.mapDiv.style.backgroundColor = 'black';
    this.content.node.appendChild(this.mapDiv);

    // Add layer control button to toolbar
    this.addLayerControlButton();
  }

  private async initialize(selectedFileName: string | null) {
    if (!this.imageSessionContext) {
      return;
    }

    this.imageSessionContext
      .initialize()
      .then(async value => {
        if (value) {
          if (this.imageSessionContext) {
            await this.sessionContextDialogs.selectKernel(
              this.imageSessionContext
            );

            // Install the code on the Jupyter session needed to create tiles and setup the server side of the comm
            // channel.
            const kernelSetupFuture =
              this.imageSessionContext.session?.kernel?.requestExecute({
                code: KERNEL_SETUP_CODE
              });
            if (kernelSetupFuture) {
              kernelSetupFuture.onIOPub = function (
                msg: KernelMessage.IIOPubMessage
              ): void {
                const msgType = msg.header.msg_type;
                switch (msgType) {
                  case 'execute_result':
                    console.log('Completed kernel setup for JupyterImageLayer');
                    break;
                  case 'error':
                    console.error(
                      'Unable to setup kernel for JupyterImageLayer'
                    );
                    console.error(msg);
                    break;
                }
              };
            }

            // Initialize CommService with kernel connection
            const kernel = this.imageSessionContext.session?.kernel;
            if (kernel) {
              this.commService = new CommService(kernel);
              // this.commService.setDebugMode(true);

              await this.commService.initialize('osml_comm_target');

              // Update services with new CommService
              this.imageTileService = new ImageTileService(this.commService, {
                enableDebugLogging: this.enableDebugLogging
              });
              this.featureTileService = new FeatureTileService(
                this.commService
              );

              console.log('CommService initialized successfully.');
            }

            // Create the client side of the comm channel (legacy support).
            console.log('Setting up new comm!');
            this.comm =
              this.imageSessionContext.session?.kernel?.createComm(
                'osml_comm_target'
              );
            if (this.comm) {
              this.comm.open('Open comm');
            }
            console.log('Comm setup completed.');
          }

          // Once the session is initialized we can ask the user to select an image for display.
          // This widget is not a general full-earth geographic display so a single image must be
          // selected as the base layer.

          if (selectedFileName) {
            await this.openImage(selectedFileName);
          }
        }
      })
      .catch(reason => {
        console.error(
          `Failed to initialize the session in OSML Image Viewer.\n${reason}`
        );
      });
  }

  public statusSignal: Signal<any, any> = new Signal<any, any>(this);

  /**
   * Debug logging utility
   */
  private debugLog(message: string, data?: any): void {
    if (this.enableDebugLogging) {
      console.log(`[ImageViewerWidget] ${message}`, data || '');
    }
  }

  /**
   * Shows the React-based feature properties dialog
   */
  private showFeaturePropertiesDialog(feature: any): void {
    console.log(
      '[ImageViewerWidget] showFeaturePropertiesDialog called with:',
      feature
    );

    if (!feature) {
      console.log(
        '[ImageViewerWidget] showFeaturePropertiesDialog early return: no feature'
      );
      return;
    }

    const properties = feature.properties || {};
    console.log('[ImageViewerWidget] Feature properties:', properties);

    // Hide any existing dialog first
    this.hideFeaturePropertiesDialog();

    // Create FeaturePropertiesDialog widget directly
    this.featurePropertiesDialog = new FeaturePropertiesDialog(feature, () =>
      this.hideFeaturePropertiesDialog()
    );

    this.featurePropertiesDialog.id = 'feature-properties-dialog';
    this.featurePropertiesDialog.title.label = 'Feature Properties';

    // Add to document body for proper modal behavior
    document.body.appendChild(this.featurePropertiesDialog.node);
    this.featurePropertiesDialogVisible = true;

    // Force the widget to render
    this.featurePropertiesDialog.update();

    console.log(
      '[ImageViewerWidget] React feature properties dialog created and shown'
    );
    console.log(
      '[ImageViewerWidget] Dialog node:',
      this.featurePropertiesDialog.node
    );
    console.log(
      '[ImageViewerWidget] Dialog node parent:',
      this.featurePropertiesDialog.node.parentElement
    );
    this.debugLog('Feature properties dialog shown', { feature });
  }

  /**
   * Hides the React-based feature properties dialog
   */
  private hideFeaturePropertiesDialog(): void {
    if (this.featurePropertiesDialog && this.featurePropertiesDialogVisible) {
      this.featurePropertiesDialog.node.remove();
      this.featurePropertiesDialog.dispose();
      this.featurePropertiesDialog = undefined;
      this.featurePropertiesDialogVisible = false;
      console.log('[ImageViewerWidget] React feature properties dialog hidden');
      this.debugLog('Feature properties dialog hidden');
    }
  }

  /**
   * Handles click events on the map to show feature properties dialog
   */
  private handleMapClick(info: any, event: any): boolean {
    // Always log click events for debugging
    console.log('[ImageViewerWidget] Map clicked - Raw info:', info);
    console.log('[ImageViewerWidget] Map clicked - Event:', event);
    console.log('[ImageViewerWidget] Map clicked - Has object:', !!info.object);
    console.log('[ImageViewerWidget] Map clicked - Layer info:', {
      layer: info.layer?.id,
      sourceLayer: info.sourceLayer?.id,
      picked: info.picked,
      coordinate: info.coordinate,
      x: info.x,
      y: info.y
    });

    this.debugLog('Map clicked', { info, event });

    // Hide dialog if clicking on empty area
    if (!info.object) {
      console.log('[ImageViewerWidget] No object clicked, hiding dialog');
      this.hideFeaturePropertiesDialog();
      return false;
    }

    // Show React dialog for picked feature
    if (info.object && info.x !== undefined && info.y !== undefined) {
      console.log(
        '[ImageViewerWidget] Feature clicked, showing dialog:',
        info.object
      );
      this.showFeaturePropertiesDialog(info.object);
      return true; // Mark as handled
    }

    console.log('[ImageViewerWidget] Click event not handled');
    return false;
  }

  /**
   * Create a TileLayer for the image with swappable getTileData function
   */
  private createImageLayer(
    imageName: string,
    getTileData: TileDataFunction
  ): TileLayer {
    return new TileLayer({
      id: `image-${imageName}`,
      data: [], // Required by TileLayer but not used since we provide getTileData
      tileSize: 512,
      minZoom: -10,
      maxZoom: 10,
      maxCacheSize: 100,
      maxCacheByteSize: 50 * 1024 * 1024, // 50MB cache
      refinementStrategy: 'best-available',
      debounceTime: 100,
      getTileData: (tileProps: any) => {
        // Extract tile coordinates from TileLoadProps
        const x = tileProps.x ?? tileProps.index?.x;
        const y = tileProps.y ?? tileProps.index?.y;
        const z = tileProps.z ?? tileProps.index?.z;

        // Convert TileLayer's tile format to our ITile format
        const scale = Math.pow(2, -z);
        const tileSize = 512;
        const tile: ITile = {
          x,
          y,
          z,
          left: x * tileSize * scale,
          top: y * tileSize * scale,
          right: (x + 1) * tileSize * scale,
          bottom: (y + 1) * tileSize * scale
        };

        this.debugLog(`Loading tile ${x}-${y}-${z}`, tile);
        return getTileData(tile);
      },
      renderSubLayers: (props: any) => {
        const { tile, data } = props;

        if (!data) {
          return null;
        }

        // Extract tile bounds from the tile's bbox
        const { bbox } = tile;
        let bounds: number[];

        if ('west' in bbox) {
          // Geographic bounds format
          bounds = [bbox.west, bbox.south, bbox.east, bbox.north];
        } else {
          // Image coordinate bounds format
          bounds = [bbox.left, bbox.bottom, bbox.right, bbox.top];
        }

        this.debugLog(`Rendering tile ${tile.x}-${tile.y}-${tile.z}`, {
          bounds,
          hasData: !!data,
          dataType: typeof data
        });

        return new BitmapLayer({
          ...props,
          id: `${props.id}-bitmap`,
          image: data,
          bounds,
          data: null // Explicitly set data to null to avoid BitmapLayer confusion
        });
      },
      onTileLoad: (tile: any) => {
        this.debugLog(`Tile loaded: ${tile.x}-${tile.y}-${tile.z}`);
      },
      onTileError: (error: any, tile?: any) => {
        const tileInfo = tile ? `${tile.x}-${tile.y}-${tile.z}` : 'unknown';
        console.error(`Tile error for ${tileInfo}:`, error);
        this.debugLog(`Tile error for ${tileInfo}`, error);
      }
    });
  }

  /**
   * Creates a new Deck.gl visualization containing a base layer for this tiled image.
   *
   * @param imageName the full path of the image on the Jupyter notebook instance.
   */
  public async openImage(imageName: string | null) {
    console.log('DEBUG: ImageViewerWidget.openImage("' + imageName + '")');
    if (!imageName) {
      return;
    }

    if (!this.comm && !this.useMockData) {
      this.statusSignal.emit(
        `Unable to load ${imageName} because plugin setup failed.`
      );
      return;
    }

    try {
      this.statusSignal.emit(`Loading ${imageName} ...`);

      // Only send load request if using real data
      if (!this.useMockData) {
        const loadStatus = await new Promise<string>((resolve, reject) => {
          const commFuture = this.comm!.send({
            type: 'IMAGE_LOAD_REQUEST',
            dataset: imageName
          });

          // Set a timeout to reject the promise if we don't get a response
          const timeoutId = setTimeout(() => {
            reject(new Error('Timeout waiting for image load response'));
          }, 30000); // 30 second timeout

          commFuture.onIOPub = (msg: any): void => {
            const msgType = msg.header.msg_type;
            if (msgType === 'comm_msg') {
              console.log('Received image load response from comm!!!');
              clearTimeout(timeoutId);
              resolve(msg.content.data.status);
            }
          };

          // Handle comm future done with error
          commFuture.done.catch(error => {
            clearTimeout(timeoutId);
            reject(error);
          });
        });

        this.statusSignal.emit(`Loading ${imageName} ... ${loadStatus}`);
      }
    } catch (error: any) {
      console.error('Error loading image:', error);
      this.statusSignal.emit(`Error loading ${imageName}: ${error.message}`);
    }

    this.imageName = imageName;

    // Create tile data function - can easily swap between mock and real data
    const getTileData = this.useMockData
      ? this.imageTileService.createMockTileDataFunction()
      : this.imageTileService.createRealTileDataFunction(imageName);

    // Create the image layer directly using TileLayer
    const imageLayer = this.createImageLayer(imageName, getTileData);

    // Create a canvas element for Deck.gl
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.backgroundColor = 'black'; // Set canvas background to black
    this.mapDiv.appendChild(canvas);

    // Create Deck.gl instance with OrthographicView
    // Position the view to show the image starting from coordinate (0,0) at full resolution
    this.deckInstance = new Deck({
      canvas: canvas,
      width: '100%',
      height: '100%',
      initialViewState: {
        target: [0, 0, 0],
        zoom: 0, // Start at full resolution (zoom level 0)
        minZoom: -10,
        maxZoom: 10
      } as any,
      views: [
        new OrthographicView({
          id: 'ortho',
          controller: true,
          flipY: true // Assign 0,0 to the upper left corner to match image coordinate systems
        })
      ],
      layers: [imageLayer],
      parameters: {
        clearColor: [0, 0, 0, 1] // Black background (RGBA: 0, 0, 0, 1)
      } as any, // Type assertion to work around Deck.gl typing issues
      onViewStateChange: ({ viewState }) => {
        // Handle view state changes if needed
        this.debugLog('View state changed:', viewState);
        // Use throttled update to prevent excessive layer updates during rapid viewport changes
        this.throttledViewportUpdate();
      },
      onClick: (info: any, event: any) => {
        return this.handleMapClick(info, event);
      }
    }) as any; // Type assertion to work around Deck.gl typing issues

    this.statusSignal.emit(`${imageName} loaded successfully`);
    return;
  }

  /**
   * Create a feature layer for overlay data using TiledOverlayLayer
   */
  private createFeatureLayer(
    overlayName: string,
    getTileData: FeatureTileDataFunction
  ): TiledOverlayLayer {
    // Get current colors from state
    const customColor = this.layerColors.get(overlayName) ?? [255, 0, 0, 128];
    const lineColor = customColor;

    console.log(
      `[ImageViewerWidget] Creating TiledOverlayLayer for ${overlayName}`
    );
    return new TiledOverlayLayer({
      id: `features-${overlayName}`,
      data: [], // Required by TileLayer but not used since we provide getTileData
      getTileData, // This is our custom FeatureTileDataFunction
      tileSize: 512,
      minZoom: -10,
      maxZoom: 10,
      maxCacheSize: 100,
      maxCacheByteSize: 50 * 1024 * 1024, // 50MB cache
      debounceTime: 100,
      // Culling options
      maxFeaturesPerTile: 10000,
      minFeatureAreaPixels: 1.0,
      minFeatureSizePixels: 0.5,
      // LOD options
      simplificationTolerance: 0.5,
      clusterDistance: 20,
      lodZoomThresholds: [-3, 0, 3],
      // Rendering options
      featureFillColor: lineColor, // Use full color for features
      featureLineColor: lineColor,
      featureLineWidth: 1,
      adaptivePointSize: true,
      enableDebugLogging: true || this.enableDebugLogging
    } as any); // Type assertion to bypass the prop type conflict
  }

  /**
   * Create a TiledOverlayLayer for model inference results
   */
  public createModelFeatureLayer(modelName: string): void {
    if (!this.imageName || !this.deckInstance) {
      console.warn(
        'Cannot create model feature layer: No image loaded or Deck instance not initialized'
      );
      return;
    }

    if (!modelName || modelName.trim() === '') {
      console.warn('Cannot create model feature layer: No model name provided');
      return;
    }

    this.statusSignal.emit(`Creating model feature layer for: ${modelName}`);

    // Remove existing model layer if present (only one model at a time)
    this.clearModelLayers();

    // Create model feature tile data function
    const getModelFeatureTileData =
      this.featureTileService.createModelFeatureDataFunction(
        this.imageName,
        modelName
      );

    this.debugLog(`Creating model layer for model: ${modelName}`);

    // Create the model feature layer using TiledOverlayLayer
    const modelFeatureLayer = this.createFeatureLayer(
      modelName,
      getModelFeatureTileData
    );

    // Store the model layer
    this.modelLayers.set(modelName, modelFeatureLayer);

    // Update Deck.gl layers
    this.updateDeckLayers();

    this.statusSignal.emit(`Model feature layer created: ${modelName}`);
  }

  /**
   * Clear all model feature layers
   */
  public clearModelLayers(): void {
    if (this.modelLayers.size > 0) {
      // Clear caches and dispose of layers
      for (const modelLayer of this.modelLayers.values()) {
        modelLayer.clearCache();
      }
      this.modelLayers.clear();

      // Update Deck.gl layers
      this.updateDeckLayers();

      this.debugLog('Model layers cleared');
      this.statusSignal.emit('Model layers cleared');
    }
  }

  public addLayer(layerDataPath: string | null) {
    if (!layerDataPath || !this.imageName || !this.deckInstance) {
      return;
    }

    this.statusSignal.emit(`Adding overlays from ${layerDataPath}`);

    // Create feature tile data function - can easily swap between mock and real data
    const getFeatureTileData = this.useMockFeatureData
      ? this.featureTileService.createMockFeatureDataFunction(0.1) // 10% corner square size
      : this.featureTileService.createRealFeatureDataFunction(
          this.imageName,
          layerDataPath
        );

    this.debugLog(`Adding layer with mock data: ${this.useMockFeatureData}`);
    this.debugLog(`Layer path: ${layerDataPath}`);

    // Create the feature layer using TiledOverlayLayer
    const featureLayer = this.createFeatureLayer(
      layerDataPath,
      getFeatureTileData
    );

    // Store the feature layer
    this.featureLayers.set(layerDataPath, featureLayer);

    // Update Deck.gl layers
    this.updateDeckLayers();

    // Notify layer control button to update state
    if (this.layerControlButton) {
      this.layerControlButton.onLayersChanged();
    }

    this.statusSignal.emit(`Added overlay layer: ${layerDataPath}`);
    return;
  }

  /**
   * Add a named dataset from kernel memory as a layer
   */
  public addNamedDataset(datasetName: string): void {
    if (!datasetName || !this.imageName || !this.deckInstance) {
      console.warn('Cannot add named dataset: Missing required parameters', {
        datasetName: !!datasetName,
        imageName: !!this.imageName,
        deckInstance: !!this.deckInstance
      });
      return;
    }

    this.statusSignal.emit(`Adding dataset layer: ${datasetName}`);

    // Create feature tile data function using the real data function
    // The image name is the current image and overlayName is the dataset name
    const getFeatureTileData =
      this.featureTileService.createRealFeatureDataFunction(
        this.imageName,
        datasetName
      );

    this.debugLog(
      `Adding named dataset layer: ${datasetName} for image: ${this.imageName}`
    );

    // Create the feature layer using the dataset name as the layer ID
    const featureLayer = this.createFeatureLayer(
      datasetName,
      getFeatureTileData
    );

    // Store the feature layer using the dataset name as the key
    this.featureLayers.set(datasetName, featureLayer);

    // Update Deck.gl layers
    this.updateDeckLayers();

    // Notify layer control button to update state
    if (this.layerControlButton) {
      this.layerControlButton.onLayersChanged();
    }

    this.statusSignal.emit(`Added dataset layer: ${datasetName}`);
  }

  /**
   * Get all feature layers
   */
  private getFeatureLayers(): TiledOverlayLayer[] {
    return Array.from(this.featureLayers.values());
  }

  /**
   * Get all model layers
   */
  private getModelLayers(): TiledOverlayLayer[] {
    return Array.from(this.modelLayers.values());
  }

  /**
   * Get all layers (feature + model layers) that are visible
   */
  private getAllLayers(): TiledOverlayLayer[] {
    const visibleLayers: TiledOverlayLayer[] = [];

    // Add visible feature layers
    for (const [layerId, layer] of this.featureLayers.entries()) {
      const visible = this.layerVisibility.get(layerId) ?? true;
      if (visible) {
        visibleLayers.push(layer);
      }
    }

    // Add visible model layers
    for (const [layerId, layer] of this.modelLayers.entries()) {
      const visible = this.layerVisibility.get(layerId) ?? true;
      if (visible) {
        visibleLayers.push(layer);
      }
    }

    return visibleLayers;
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
    if (!this.deckInstance || !this.imageName) {
      return;
    }

    // Recreate the image layer (this is lightweight since TileLayer handles caching)
    const getTileData = this.useMockData
      ? this.imageTileService.createMockTileDataFunction()
      : this.imageTileService.createRealTileDataFunction(this.imageName);

    const imageLayer = this.createImageLayer(this.imageName, getTileData);
    const allLayers = this.getAllLayers();

    this.debugLog(
      `Updating deck layers: image layer + ${allLayers.length} feature/model layers`
    );

    this.deckInstance.setProps({
      layers: [imageLayer, ...allLayers]
    });
  }

  /**
   * Set whether to use mock data for tiles (useful for testing)
   */
  public setUseMockData(useMock: boolean): void {
    this.useMockData = useMock;
    this.updateDeckLayers();
  }

  /**
   * Enable/disable debug logging
   */
  public setDebugLogging(enabled: boolean): void {
    this.enableDebugLogging = enabled;
  }

  /**
   * Returns the current kernel session providing access to image tiles.
   */
  get session(): ISessionContext | undefined {
    return this.imageSessionContext;
  }

  /**
   * Handler triggered when a user closes the main area window containing this widget. Implementation expands on the
   * super's implementation to ensure class specific resources are cleaned up.
   *
   * @param msg the lumino message
   * @protected
   */
  protected onCloseRequest(msg: Message): void {
    console.log('onCloseRequest for ImageViewerWidget');
    super.onCloseRequest(msg);
    this.dispose();
  }

  /**
   * Set whether to use mock feature data (useful for testing)
   */
  public setUseMockFeatureData(useMock: boolean): void {
    this.useMockFeatureData = useMock;
    // Clear existing feature layers and recreate them with new data source
    this.featureLayers.clear();
    this.updateDeckLayers();
  }

  /**
   * Add a test feature layer with mock data for testing purposes
   */
  public addTestFeatureLayer(): void {
    if (!this.deckInstance) {
      console.warn(
        'Cannot add test feature layer: Deck instance not initialized'
      );
      return;
    }

    const testLayerName = 'test-features';

    // Enable mock feature data and debug logging for testing
    this.useMockFeatureData = true;
    this.enableDebugLogging = true;

    console.log('Adding test feature layer with mock data...');
    this.statusSignal.emit('Adding test feature layer with mock squares...');

    // Add the test layer
    this.addLayer(testLayerName);

    console.log(
      'Test feature layer added. You should see squares at tile centers and corners.'
    );
    console.log('- Zoom >= 0: Individual square features');
    console.log('- Zoom < 0: Heatmap aggregation');
  }

  /**
   * Set the selected model for tile processing
   */
  public setSelectedModel(modelName: string, modelEnabled?: boolean): void {
    this.selectedModel = modelName;
    if (modelEnabled !== undefined) {
      this.selectedModelEnabled = modelEnabled;
    }
    console.log(
      `Selected model updated - Name: ${modelName}, Enabled: ${this.selectedModelEnabled}`
    );

    if (!this.selectedModelEnabled) {
      this.statusSignal.emit('Model processing disabled');
    } else if (modelName) {
      this.statusSignal.emit(`Model selected: ${modelName}`);
    } else {
      this.statusSignal.emit('Model enabled but no name specified');
    }
  }

  /**
   * Get the currently selected model
   */
  public getSelectedModel(): string {
    return this.selectedModel;
  }

  /**
   * Get the currently selected model enabled state
   */
  public getSelectedModelEnabled(): boolean {
    return this.selectedModelEnabled;
  }

  /**
   * Set whether to use TiledOverlayLayer instead of MultiResolutionFeatureLayer
   */
  public setUseTiledOverlayLayer(useTiled: boolean): void {
    if (this.useTiledOverlayLayer !== useTiled) {
      this.useTiledOverlayLayer = useTiled;
      console.log(
        `[ImageViewerWidget] Switched to ${useTiled ? 'TiledOverlayLayer' : 'MultiResolutionFeatureLayer'}`
      );

      // Clear existing layers to force recreation with new layer type
      this.featureLayers.clear();
      this.modelLayers.clear();
      this.updateDeckLayers();

      this.statusSignal.emit(
        `Layer implementation switched to ${useTiled ? 'TiledOverlayLayer' : 'MultiResolutionFeatureLayer'}`
      );
    }
  }

  /**
   * Get debug information about the current state
   */
  public getDebugInfo(): any {
    return {
      useMockData: this.useMockData,
      useMockFeatureData: this.useMockFeatureData,
      enableDebugLogging: this.enableDebugLogging,
      useTiledOverlayLayer: this.useTiledOverlayLayer,
      featureLayerCount: this.featureLayers.size,
      featureLayerNames: Array.from(this.featureLayers.keys()),
      imageName: this.imageName,
      deckInstanceExists: !!this.deckInstance,
      selectedModel: this.selectedModel,
      selectedModelEnabled: this.selectedModelEnabled
    };
  }

  /**
   * Layer management methods for LayerControl
   */

  /**
   * Set layer visibility
   */
  public setLayerVisibility(layerId: string, visible: boolean): void {
    this.layerVisibility.set(layerId, visible);
    this.updateDeckLayers();

    // Notify layer control button to update state
    if (this.layerControlButton) {
      this.layerControlButton.onLayersChanged();
    }

    this.statusSignal.emit(`Layer ${layerId} ${visible ? 'shown' : 'hidden'}`);
  }

  /**
   * Set layer color
   */
  public setLayerColor(
    layerId: string,
    color: [number, number, number, number]
  ): void {
    this.layerColors.set(layerId, color);

    // Recreate the specific layer with new color
    if (this.featureLayers.has(layerId)) {
      const layer = this.featureLayers.get(layerId);
      if (layer) {
        // Get the existing getTileData function
        const existingLayer = layer as any;
        const getTileData = existingLayer.props.getTileData;

        // Create new layer with updated color
        const newLayer = this.createFeatureLayer(layerId, getTileData);

        // Replace the layer
        this.featureLayers.set(layerId, newLayer);
      }
    }

    if (this.modelLayers.has(layerId)) {
      const layer = this.modelLayers.get(layerId);
      if (layer) {
        // For model layers, we need to recreate using the existing pattern
        const existingLayer = layer as any;
        const getTileData = existingLayer.props.getTileData;

        const customColor = this.layerColors.get(layerId) ?? [255, 0, 0, 128];
        const fillColor = [
          customColor[0],
          customColor[1],
          customColor[2],
          Math.floor(customColor[3] * 0.5)
        ] as [number, number, number, number];
        const lineColor = customColor;

        // Create new model layer with updated color using TiledOverlayLayer
        const newModelLayer = this.createFeatureLayer(layerId, getTileData);

        // Replace the layer
        this.modelLayers.set(layerId, newModelLayer);
      }
    }

    // Update Deck.gl layers
    this.updateDeckLayers();

    this.statusSignal.emit(`Layer ${layerId} color updated`);
  }

  /**
   * Delete a layer
   */
  public deleteLayer(layerId: string): void {
    // Remove from feature layers
    if (this.featureLayers.has(layerId)) {
      const layer = this.featureLayers.get(layerId);
      if (layer) {
        layer.clearCache();
      }
      this.featureLayers.delete(layerId);
    }

    // Remove from model layers
    if (this.modelLayers.has(layerId)) {
      const layer = this.modelLayers.get(layerId);
      if (layer) {
        layer.clearCache();
      }
      this.modelLayers.delete(layerId);
    }

    // Clean up layer state
    this.layerVisibility.delete(layerId);
    this.layerColors.delete(layerId);

    // Update deck layers
    this.updateDeckLayers();

    // Notify layer control button to update state
    if (this.layerControlButton) {
      this.layerControlButton.onLayersChanged();
    }

    this.statusSignal.emit(`Layer ${layerId} deleted`);
  }

  /**
   * Get layer information for the layer control dialog
   */
  public getLayerInfo(): any[] {
    const layers: any[] = [];

    // Add feature layers
    for (const [layerId] of this.featureLayers.entries()) {
      layers.push({
        id: layerId,
        name: layerId,
        visible: this.layerVisibility.get(layerId) ?? true,
        color: this.layerColors.get(layerId) ?? [255, 0, 0, 128],
        type: 'feature'
      });
    }

    // Add model layers
    for (const [layerId] of this.modelLayers.entries()) {
      layers.push({
        id: layerId,
        name: layerId,
        visible: this.layerVisibility.get(layerId) ?? true,
        color: this.layerColors.get(layerId) ?? [255, 0, 0, 128],
        type: 'model'
      });
    }

    return layers;
  }

  /**
   * Initialize layer control toolbar button
   */
  public addLayerControlButton(): void {
    if (!this.layerControlButton) {
      this.layerControlButton = new LayerControlToolbarButton(this);
      this.toolbar.addItem('layerControl', this.layerControlButton);
    }
  }

  /**
   * Implementation expand the super's dispose function to ensure class specific resources are cleaned up.
   */
  dispose(): void {
    // Clean up viewport update timeout
    if (this.viewportUpdateTimeout) {
      clearTimeout(this.viewportUpdateTimeout);
      this.viewportUpdateTimeout = undefined;
    }

    // Clean up Deck.gl instance
    if (this.deckInstance) {
      this.deckInstance.finalize();
      this.deckInstance = undefined;
    }

    // Clear feature layers
    for (const featureLayer of this.featureLayers.values()) {
      featureLayer.clearCache();
    }
    this.featureLayers.clear();

    // Clear model layers
    for (const modelLayer of this.modelLayers.values()) {
      modelLayer.clearCache();
    }
    this.modelLayers.clear();

    // Clean up services
    try {
      this.imageTileService?.dispose();
      this.featureTileService?.dispose();
      this.kernelService?.dispose();
      this.commService?.dispose();
    } catch (e) {
      console.warn('Exception caught cleaning up service resources');
      console.debug(e);
    }

    // Clean up feature properties dialog
    this.hideFeaturePropertiesDialog();

    // Clean up DOM
    if (this.mapDiv) {
      this.mapDiv.innerHTML = '';
    }

    console.log('Shutting down session and comm as part of dispose()');
    try {
      this.comm?.close();
      this.imageSessionContext?.session?.shutdown();
      this.imageSessionContext?.dispose();
      this.imageSessionContext = undefined;
    } catch (e) {
      console.warn('Exception caught cleaning up session and comm resources');
      console.debug(e);
    }

    super.dispose();
  }
}

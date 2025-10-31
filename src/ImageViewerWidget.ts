// Copyright Amazon.com, Inc. or its affiliates.

import { ServiceManager } from '@jupyterlab/services';
import { MainAreaWidget, Toolbar, ISessionContext } from '@jupyterlab/apputils';
import {
  IPropertyInspector,
  IPropertyInspectorProvider
} from '@jupyterlab/property-inspector';

import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import { Signal } from '@lumino/signaling';
import * as React from 'react';

import { Deck, OrthographicView } from '@deck.gl/core';

import { TiledOverlayLayer } from './layers';
import {
  CommService,
  ImageTileService,
  FeatureTileService,
  KernelService,
  LayerManager,
  ImageManager,
  GeocoderService,
  IOverlayLoadResponse
} from './services';
import {
  ImageViewerPropertyInspector,
  ICurrentSelection,
  IImageInfo
} from './components';
import { logger } from './utils';

/**
 * This widget provides a way to display geospatial information in a Jupyter environment overlaid on an image.
 */
export class ImageViewerWidget extends MainAreaWidget {
  private mapDiv: HTMLDivElement;
  private deckInstance?: Deck;
  private imageName?: string;
  private viewportUpdateTimeout?: NodeJS.Timeout;
  private lastViewportUpdate: number = 0;

  // Service instances
  private kernelService: KernelService;
  private layerManager: LayerManager;
  private imageManager: ImageManager;
  private commService: CommService;
  private imageTileService: ImageTileService;
  private featureTileService: FeatureTileService;
  private geocoderService: GeocoderService;

  // Property Inspector
  private propertyInspector?: IPropertyInspector;
  private currentSelection: ICurrentSelection = { type: null };
  private imageInfo: IImageInfo = {};

  /**
   * Asynchronus Factory Pattern for the ImageViewerWidget.
   *
   * This widget requires an asynchronus initialization step as part of the construction process. Since
   * typescript constructors must always be synchronus we have adopted the Asyncronus Factory Pattern for
   * creation of these instances. This static async function creates the new instance and then initializes it
   * returning a promise of a fully configured instance.
   *
   * @param manager Jupyter service manager
   * @param selectedFileName Path of the base image on the local file system
   */
  public static async createInstance(
    manager: ServiceManager.IManager,
    selectedFileName: string | null
  ): Promise<ImageViewerWidget> {
    const widget = new ImageViewerWidget(manager);
    await widget.initialize();

    // If an image was selected open it
    if (selectedFileName) {
      await widget.openImage(selectedFileName);
    }
    return widget;
  }

  /**
   * Private constructor for ImageViewerWidget. This class can not be created directly. Instead use the static
   * asynchronus factory methods.
   *
   * @param manager Jupyter service manager
   */
  private constructor(manager: ServiceManager.IManager) {
    // Initialize the base class with a content area and toolbar
    const content = new Widget();
    const toolbar = new Toolbar();
    super({ content, toolbar });
    this.id = 'osml-jupyter-extension:image-viewer';
    this.title.label = 'OSML Image View';
    this.title.closable = true;

    // Initialize services
    this.kernelService = new KernelService(manager);
    this.commService = new CommService();
    this.imageTileService = new ImageTileService(this.commService);
    this.featureTileService = new FeatureTileService(this.commService);
    this.geocoderService = new GeocoderService(this.commService);
    this.layerManager = new LayerManager();
    this.imageManager = new ImageManager();

    // Create a new div that will contain the Deck.gl managed content. This div will be the full window in the
    // Jupyter tabbed panel.
    this.mapDiv = document.createElement('div');
    this.mapDiv.id = 'map-' + Date.now();
    this.mapDiv.style.width = '100%';
    this.mapDiv.style.height = '100%';
    this.mapDiv.style.backgroundColor = 'black';
    this.content.node.appendChild(this.mapDiv);
  }

  /**
   * The initialization of this class includes having a user select a Python kernel that will support the backend
   * operations. Once selected this widget will run code on the kernel that establishes a "comm" channel and sets
   * up the raster/vector tile readers and caches using the osml-imagery-toolkit. This comm messaging channel is
   * required by several of the services that contain business logic for this widget.
   */
  private async initialize() {
    try {
      logger.info('Initializing ImageViewerWidget services');

      // Use KernelService to handle kernel initialization
      await this.kernelService.initialize();

      // Ensure the user selected a kernel
      const kernel = this.kernelService.getKernel();
      if (!kernel) {
        throw new Error('Kernel not available after initialization');
      }

      // Configure the messaging service to connect to the selected kernel
      await this.commService.initialize(kernel, 'osml_comm_target');

      logger.debug('ImageViewerWidget services initialized successfully');

      // Connect service signals
      this.layerManager.layersChanged.connect(() => {
        this.updateDeckLayers();
      });

      this.imageManager.imageChanged.connect(() => {
        this.updateDeckLayers();
      });

      this.imageManager.imageLoaded.connect((_, imageMetadata) => {
        this.statusSignal.emit(`${imageMetadata.name} loaded successfully`);
        logger.info(`Image loaded successfully: ${imageMetadata.name}`);
        this.createDeckInstance(imageMetadata);
      });

      this.imageManager.imageLoadError.connect((_, errorMessage) => {
        this.statusSignal.emit(`Error: ${errorMessage}`);
        logger.error(`Image load failed: ${errorMessage}`);
      });
    } catch (reason) {
      logger.error(`Failed to initialize ImageViewerWidget: ${reason}`);
      console.error(
        `Failed to initialize the session in OSML Image Viewer.\n${reason}`
      );
    }
  }

  public statusSignal: Signal<any, any> = new Signal<any, any>(this);

  /**
   * Handles click events on the map to update property inspector with selection info
   */
  private handleMapClick(info: any, event: any): boolean {
    // Deck.gl picking associated an object with the click. Update property inspector
    // with feature selection for that object.
    if (info.object && info.x !== undefined && info.y !== undefined) {
      // Update property inspector with feature selection
      this.updatePropertyInspectorSelection('feature', info.object);
      return true; // Mark as handled
    }

    // If click was not associated with an object, update property inspector with location info
    // Use coordinate from Deck.gl which gives us the world coordinates in the OrthographicView
    if (!info.object && info.coordinate) {
      const [x, y] = info.coordinate;
      // Update property inspector with location selection
      this.updatePropertyInspectorSelection('location', null, { x, y });
      return true; // Mark as handled
    }

    // Click not handled - clear property inspector selection
    this.clearPropertyInspectorSelection();
    return false;
  }

  /**
   * Create Deck.gl instance with the loaded image
   */
  private createDeckInstance(imageMetadata: any): void {
    // Update imageName for compatibility with existing code
    this.imageName = imageMetadata.name;

    logger.info(`Setting GeocoderService Image Context for ${this.imageName}`);
    // Set image context for GeocoderService
    this.geocoderService.setImageContext(
      imageMetadata.name,
      imageMetadata.width,
      imageMetadata.height
    );

    // Load metadata for property inspector
    this.loadImageMetadataForPropertyInspector(imageMetadata.name);

    // Get the initial viewport state from ImageManager
    const initialViewState = this.imageManager.getInitialViewState();
    if (!initialViewState) {
      console.error('Could not get initial view state from ImageManager');
      return;
    }

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
      initialViewState: initialViewState as any,
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
        // Handle view state changes if needed
        // Use throttled update to prevent excessive layer updates during rapid viewport changes
        this.throttledViewportUpdate();
      },
      onClick: (info: any, event: any) => {
        return this.handleMapClick(info, event);
      }
    }) as any; // Type assertion to work around Deck.gl typing issues
  }

  /**
   * Creates a new Deck.gl visualization containing a base layer for this tiled image.
   *
   * @param imageName the full path of the image on the Jupyter notebook instance.
   */
  public async openImage(imageName: string | null) {
    if (!imageName) {
      return;
    }

    if (!this.commService.isReady()) {
      const errorMessage = `Unable to load ${imageName} because plugin setup failed.`;
      this.statusSignal.emit(errorMessage);
      logger.error(`Image load failed - comm service not ready: ${imageName}`);
      return;
    }

    try {
      this.statusSignal.emit(`Loading ${imageName} ...`);

      // First, load image to get metadata and determine dimensions
      const imageLoadResponse =
        await this.imageTileService.loadImage(imageName);
      if (
        !imageLoadResponse.success ||
        !imageLoadResponse.width ||
        !imageLoadResponse.height
      ) {
        throw new Error(
          `Could not load image: ${imageName} - ${imageLoadResponse.error || 'Unknown error'}`
        );
      }

      // Create a getTileData function for the ImageManager
      const getTileData =
        this.imageTileService.createTileDataFunction(imageName);

      // Use ImageManager to load the image with proper parameters
      this.imageManager.loadImage(
        imageName,
        imageLoadResponse.width,
        imageLoadResponse.height,
        getTileData
      );

      // The rest of the initialization will be handled by the imageLoaded signal
      logger.info(`Image ${imageName} loaded successfully.`);
    } catch (error: any) {
      logger.error(`Failed to open image ${imageName}: ${error.message}`);
      console.error('Error loading image:', error);
      this.statusSignal.emit(`Error loading ${imageName}: ${error.message}`);
    }
  }

  public async addLayer(layerDataPath: string | null) {
    if (!layerDataPath) {
      const errorMessage = 'Error: No layer file selected';
      this.statusSignal.emit(errorMessage);
      logger.error('Layer addition failed - no layer file selected');
      return;
    }

    if (!this.imageName) {
      const errorMessage =
        'Error: No image loaded. Please open an image first before adding layers.';
      this.statusSignal.emit(errorMessage);
      logger.error('Layer addition failed - no image loaded');
      return;
    }

    if (!this.deckInstance) {
      const errorMessage = 'Error: Map viewer not initialized';
      this.statusSignal.emit(errorMessage);
      logger.error('Layer addition failed - map viewer not initialized');
      return;
    }

    if (!this.commService.isReady()) {
      const errorMessage = `Unable to load overlay ${layerDataPath} because plugin setup failed.`;
      this.statusSignal.emit(errorMessage);
      logger.error(
        `Layer addition failed - comm service not ready: ${layerDataPath}`
      );
      return;
    }

    try {
      this.statusSignal.emit(`Loading overlay from ${layerDataPath}...`);

      const loadResponse: IOverlayLoadResponse =
        await this.featureTileService.loadOverlay(
          this.imageName,
          layerDataPath
        );

      // Check if the overlay load was successful
      if (!loadResponse.success) {
        const errorMessage = `Error: ${layerDataPath} could not be loaded as an overlay layer${loadResponse.error ? ` - ${loadResponse.error}` : ''}`;
        this.statusSignal.emit(errorMessage);
        logger.error(
          `Failed to load overlay ${layerDataPath}: ${loadResponse.error || 'Unknown error'}`
        );
        return; // Exit early - don't proceed with layer creation
      }

      this.statusSignal.emit(
        `Loading overlay from ${layerDataPath}... ${loadResponse.status}`
      );
    } catch (error: any) {
      logger.error(`Failed to add layer ${layerDataPath}: ${error.message}`);
      console.error('Error loading overlay:', error);
      this.statusSignal.emit(
        `Error loading overlay ${layerDataPath}: ${error.message}`
      );
      return;
    }

    // Create feature tile data function
    const getFeatureTileData =
      this.featureTileService.createFeatureDataFunction(
        this.imageName,
        layerDataPath
      );

    // Add the feature layer via LayerManager
    this.layerManager.addFeatureLayer(layerDataPath, getFeatureTileData);

    this.statusSignal.emit(`Added overlay layer: ${layerDataPath}`);
    logger.info(`Layer added successfully: ${layerDataPath}`);
    return;
  }

  /**
   * Add a named dataset from kernel memory as a layer
   */
  public addNamedDataset(datasetName: string): void {
    if (!datasetName || !this.imageName || !this.deckInstance) {
      const errorMessage =
        'Cannot add named dataset: Missing required parameters';
      console.warn(errorMessage, {
        datasetName: !!datasetName,
        imageName: !!this.imageName,
        deckInstance: !!this.deckInstance
      });
      logger.error(
        `Dataset addition failed - missing parameters: ${datasetName}`
      );
      return;
    }

    this.statusSignal.emit(`Adding dataset layer: ${datasetName}`);

    // Create feature tile data function
    // The image name is the current image and overlayName is the dataset name
    const getFeatureTileData =
      this.featureTileService.createFeatureDataFunction(
        this.imageName,
        datasetName
      );

    // Add the feature layer via LayerManager
    this.layerManager.addFeatureLayer(datasetName, getFeatureTileData);

    this.statusSignal.emit(`Added dataset layer: ${datasetName}`);
    logger.info(`Dataset layer added successfully: ${datasetName}`);
  }

  /**
   * Get all layers (feature + model layers) that are visible
   */
  private getAllLayers(): TiledOverlayLayer[] {
    return this.layerManager.getAllVisibleLayers();
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
    const allLayers = this.getAllLayers();

    // Combine layers, only include image layer if it exists
    const layers = imageLayer ? [imageLayer, ...allLayers] : allLayers;

    this.deckInstance.setProps({
      layers: layers
    });
  }

  /**
   * Returns the current kernel session providing access to image tiles.
   */
  get session(): ISessionContext | undefined {
    return this.kernelService.getSessionContext();
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
   * Get debug information about the current state
   */
  public getDebugInfo(): any {
    const layerInfo = this.layerManager.getLayerInfo();
    return {
      layerCount: this.layerManager.getLayerCount(),
      layerNames: layerInfo.map(layer => layer.name),
      layerTypes: layerInfo.map(layer => layer.type),
      imageName: this.imageName,
      deckInstanceExists: !!this.deckInstance
    };
  }

  /**
   * Layer management methods for LayerControl
   */

  /**
   * Set layer visibility
   */
  public setLayerVisibility(layerId: string, visible: boolean): void {
    this.layerManager.setLayerVisibility(layerId, visible);
    this.statusSignal.emit(`Layer ${layerId} ${visible ? 'shown' : 'hidden'}`);
  }

  /**
   * Set layer color
   */
  public setLayerColor(
    layerId: string,
    color: [number, number, number, number]
  ): void {
    this.layerManager.setLayerColor(layerId, color);
    this.statusSignal.emit(`Layer ${layerId} color updated`);
  }

  /**
   * Delete a layer
   */
  public deleteLayer(layerId: string): void {
    this.layerManager.deleteLayer(layerId);
    this.statusSignal.emit(`Layer ${layerId} deleted`);
    logger.info(`Layer deleted successfully: ${layerId}`);
  }

  /**
   * Get layer information for the layer control dialog
   */
  public getLayerInfo(): any[] {
    return this.layerManager.getLayerInfo();
  }

  /**
   * Navigate to specific coordinates by updating the view state
   */
  public navigateToCoordinates(x: number, y: number): void {
    if (!this.deckInstance) {
      logger.error('Cannot navigate: Deck instance not available');
      return;
    }

    try {
      // Create new view state for OrthographicView with the target coordinates
      const newViewState = {
        target: [x, y, 0],
        zoom: 0, // Keep current zoom level or set a default
        transitionDuration: 500
      } as any; // Type assertion to work around strict typing

      // Update the view state using setProps
      this.deckInstance.setProps({
        initialViewState: newViewState
      });

      this.statusSignal.emit(
        `Navigated to coordinates: ${x.toFixed(2)}, ${y.toFixed(2)}`
      );
      logger.info(`Navigation successful: x=${x}, y=${y}`);
    } catch (error: any) {
      logger.error(`Navigation failed: ${error.message}`);
      this.statusSignal.emit(`Navigation failed: ${error.message}`);
    }
  }

  /**
   * Register this widget with the property inspector provider
   */
  public registerWithPropertyInspector(
    provider: IPropertyInspectorProvider
  ): void {
    if (this.propertyInspector) {
      // Already registered
      return;
    }

    try {
      this.propertyInspector = provider.register(this);
      this.updatePropertyInspectorContent();
      logger.info('Successfully registered with property inspector');
    } catch (error: any) {
      logger.error(
        `Failed to register with property inspector: ${error.message}`
      );
    }
  }

  /**
   * Update property inspector selection
   */
  private updatePropertyInspectorSelection(
    type: 'location' | 'feature',
    data?: any,
    imageCoordinates?: { x: number; y: number }
  ): void {
    this.currentSelection = {
      type,
      data,
      imageCoordinates,
      isLoadingCoordinates: type === 'location'
    };

    this.updatePropertyInspectorContent();

    // Handle coordinate conversion for location selections
    if (type === 'location' && imageCoordinates && this.imageName) {
      this.convertCoordinatesForPropertyInspector(
        imageCoordinates.x,
        imageCoordinates.y
      );
    }
  }

  /**
   * Clear property inspector selection
   */
  private clearPropertyInspectorSelection(): void {
    this.currentSelection = { type: null };
    this.updatePropertyInspectorContent();
  }

  /**
   * Convert coordinates for property inspector
   */
  private async convertCoordinatesForPropertyInspector(
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
      if (this.currentSelection.type === 'location') {
        this.currentSelection.worldCoordinates = worldCoords;
        this.currentSelection.isLoadingCoordinates = false;
        this.updatePropertyInspectorContent();
      }
    } catch (error: any) {
      if (this.currentSelection.type === 'location') {
        this.currentSelection.coordinateError = error.message;
        this.currentSelection.isLoadingCoordinates = false;
        this.updatePropertyInspectorContent();
      }
    }
  }

  /**
   * Load image metadata for property inspector
   */
  private async loadImageMetadataForPropertyInspector(
    imageName: string
  ): Promise<void> {
    this.imageInfo.name = imageName;
    this.imageInfo.isLoadingMetadata = true;
    this.updatePropertyInspectorContent();

    try {
      const response = await this.commService.sendMessage({
        type: 'IMAGE_METADATA_REQUEST',
        dataset: imageName
      });

      if (response.status === 'SUCCESS' && response.metadata) {
        this.imageInfo.metadata = response.metadata;
      } else {
        this.imageInfo.metadataError =
          response.error || 'Failed to fetch metadata';
      }
    } catch (error: any) {
      this.imageInfo.metadataError = error.message;
    } finally {
      this.imageInfo.isLoadingMetadata = false;
      this.updatePropertyInspectorContent();
    }
  }

  /**
   * Update the property inspector content
   */
  private updatePropertyInspectorContent(): void {
    if (!this.propertyInspector) {
      return;
    }

    const content = React.createElement(ImageViewerPropertyInspector, {
      currentSelection: this.currentSelection,
      imageInfo: this.imageInfo
    });

    this.propertyInspector.render(content);
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

    // Clean up services
    try {
      this.layerManager?.dispose();
      this.imageManager?.dispose();
      this.imageTileService?.dispose();
      this.featureTileService?.dispose();
      this.kernelService?.dispose();
      this.commService?.dispose();
    } catch (e) {
      console.warn('Exception caught cleaning up service resources');
      console.debug(e);
    }

    // Clean up DOM
    if (this.mapDiv) {
      this.mapDiv.innerHTML = '';
    }

    super.dispose();
  }
}

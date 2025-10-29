// Copyright Amazon.com, Inc. or its affiliates.

import { ServiceManager } from '@jupyterlab/services';
import { MainAreaWidget, Toolbar, ISessionContext } from '@jupyterlab/apputils';
import { ReactWidget } from '@jupyterlab/ui-components';

import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import { Signal } from '@lumino/signaling';

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
import { FeaturePropertiesDialog, GeocoderWidget } from './components';
import { logger } from './utils';

/**
 * This widget provides a way to display geospatial information in a Jupyter environment overlaid on an image.
 */
export class ImageViewerWidget extends MainAreaWidget {
  private mapDiv: HTMLDivElement;
  private deckInstance?: Deck;
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
  private layerManager: LayerManager;
  private imageManager: ImageManager;
  private geocoderService: GeocoderService;

  // Model selection state
  private selectedModel: string = '';
  private selectedModelEnabled: boolean = false;

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

    // Initialize services (will be properly initialized after kernel setup)
    this.commService = new CommService();
    this.imageTileService = new ImageTileService(this.commService);
    this.featureTileService = new FeatureTileService(this.commService);
    this.kernelService = new KernelService(this.manager);
    this.layerManager = new LayerManager();
    this.imageManager = new ImageManager();
    this.geocoderService = new GeocoderService(this.commService);

    // Create a new div that will contain the Deck.gl managed content. This div will be the full window in the
    // Jupyter tabbed panel.
    this.mapDiv = document.createElement('div');
    this.mapDiv.id = 'map-' + Date.now();
    this.mapDiv.style.width = '100%';
    this.mapDiv.style.height = '100%';
    this.mapDiv.style.backgroundColor = 'black';
    this.content.node.appendChild(this.mapDiv);
  }

  private async initialize(selectedFileName: string | null) {
    try {
      logger.info('Initializing ImageViewerWidget services');

      // Use KernelService to handle kernel initialization
      await this.kernelService.initialize();

      // Get kernel using accessor method
      const kernel = this.kernelService.getKernel();
      if (!kernel) {
        throw new Error('Kernel not available after initialization');
      }

      // Initialize CommService with kernel connection
      this.commService = new CommService(kernel);
      await this.commService.initialize('osml_comm_target');

      // Create services with the new CommService
      this.imageTileService = new ImageTileService(this.commService);
      this.featureTileService = new FeatureTileService(this.commService);
      this.geocoderService = new GeocoderService(this.commService);

      logger.info('ImageViewerWidget services initialized successfully');

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

      // Once the session is initialized we can ask the user to select an image for display.
      // This widget is not a general full-earth geographic display so a single image must be
      // selected as the base layer.
      if (selectedFileName) {
        await this.openImage(selectedFileName);
      }
    } catch (reason) {
      logger.error(`Failed to initialize ImageViewerWidget: ${reason}`);
      console.error(
        `Failed to initialize the session in OSML Image Viewer.\n${reason}`
      );
    }
  }

  public statusSignal: Signal<any, any> = new Signal<any, any>(this);

  /**
   * Shows the React-based feature properties dialog
   */
  private showFeaturePropertiesDialog(feature: any): void {
    if (!feature) {
      return;
    }

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
    }
  }

  /**
   * Handles click events on the map to show feature properties dialog
   */
  private handleMapClick(info: any, event: any): boolean {
    // If click was not assocaited with an object ensure the
    // properties dialog is hidden
    if (!info.object) {
      this.hideFeaturePropertiesDialog();
      return false;
    }

    // Deck.gl picking associated an object with the click. Show the
    // properties dialog for that object.
    if (info.object && info.x !== undefined && info.y !== undefined) {
      this.showFeaturePropertiesDialog(info.object);
      return true; // Mark as handled
    }

    // Click not handled
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

    // Create GeocoderWidget to enable easy navigation
    const geocoderWidget = new GeocoderWidget({
      placement: 'bottom-right',
      label: 'Navigate to coordinates',
      transitionDuration: 500,
      onNavigate: (x: number, y: number) => {
        this.navigateToCoordinates(x, y);
      },
      onStatus: (message: string) => {
        this.statusSignal.emit(message);
      },
      geocoderService: this.geocoderService
    });

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
      widgets: [geocoderWidget],
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

  /**
   * Create a TiledOverlayLayer for model inference results
   */
  public createModelFeatureLayer(modelName: string): void {
    if (!this.imageName || !this.deckInstance) {
      const errorMessage =
        'Cannot create model feature layer: No image loaded or Deck instance not initialized';
      console.warn(errorMessage);
      logger.error(
        `Model layer creation failed - ${!this.imageName ? 'no image' : 'deck not initialized'}: ${modelName}`
      );
      return;
    }

    if (!modelName || modelName.trim() === '') {
      const errorMessage =
        'Cannot create model feature layer: No model name provided';
      console.warn(errorMessage);
      logger.error('Model layer creation failed - no model name provided');
      return;
    }

    this.statusSignal.emit(`Creating model feature layer for: ${modelName}`);

    // Create model feature tile data function
    const getModelFeatureTileData =
      this.featureTileService.createModelFeatureDataFunction(
        this.imageName,
        modelName
      );

    // Add the model feature layer via LayerManager
    this.layerManager.addModelFeatureLayer(modelName, getModelFeatureTileData);

    this.statusSignal.emit(`Model feature layer created: ${modelName}`);
    logger.info(`Model feature layer created successfully: ${modelName}`);
  }

  /**
   * Clear all model feature layers
   */
  public clearModelLayers(): void {
    this.layerManager.clearModelLayers();
    this.statusSignal.emit('Model layers cleared');
    logger.info('Model layers cleared successfully');
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
   * Set the selected model for tile processing
   */
  public setSelectedModel(modelName: string, modelEnabled?: boolean): void {
    this.selectedModel = modelName;
    if (modelEnabled !== undefined) {
      this.selectedModelEnabled = modelEnabled;
    }

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
   * Get debug information about the current state
   */
  public getDebugInfo(): any {
    const layerInfo = this.layerManager.getLayerInfo();
    return {
      layerCount: this.layerManager.getLayerCount(),
      layerNames: layerInfo.map(layer => layer.name),
      layerTypes: layerInfo.map(layer => layer.type),
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
  private navigateToCoordinates(x: number, y: number): void {
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

    // Clean up feature properties dialog
    this.hideFeaturePropertiesDialog();

    // Clean up DOM
    if (this.mapDiv) {
      this.mapDiv.innerHTML = '';
    }

    super.dispose();
  }
}

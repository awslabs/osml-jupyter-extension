// Copyright Amazon.com, Inc. or its affiliates.

import { ServiceManager } from '@jupyterlab/services';
import { IPropertyInspectorProvider } from '@jupyterlab/property-inspector';

import {
  CommService,
  ImageTileService,
  FeatureTileService,
  KernelService,
  LayerManager,
  ImageManager,
  GeocoderService,
  PropertyInspectorManager
} from './index';

/**
 * Service container that manages service lifecycle and dependencies
 */
export class ServiceContainer {
  private services: Map<string, any> = new Map();
  private initialized = false;

  constructor(
    private serviceManager: ServiceManager.IManager,
    private propertyInspectorProvider?: IPropertyInspectorProvider
  ) {}

  /**
   * Initialize all services with proper dependency injection
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize services in dependency order
    const kernelService = new KernelService(this.serviceManager);
    await kernelService.initialize();
    this.services.set('kernelService', kernelService);

    const commService = new CommService();
    const kernel = kernelService.getKernel();
    if (kernel) {
      await commService.initialize(kernel, 'osml_comm_target');
    }
    this.services.set('commService', commService);

    // Services that depend on CommService
    const imageTileService = new ImageTileService(commService);
    this.services.set('imageTileService', imageTileService);

    const featureTileService = new FeatureTileService(commService);
    this.services.set('featureTileService', featureTileService);

    const geocoderService = new GeocoderService(commService);
    this.services.set('geocoderService', geocoderService);

    // Independent services
    const layerManager = new LayerManager();
    this.services.set('layerManager', layerManager);

    const imageManager = new ImageManager(imageTileService);
    this.services.set('imageManager', imageManager);

    const propertyInspectorManager = new PropertyInspectorManager();
    this.services.set('propertyInspectorManager', propertyInspectorManager);

    this.initialized = true;
  }

  /**
   * Get a service by name
   */
  public getService<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service '${name}' not found`);
    }
    return service;
  }

  /**
   * Get all services as a typed object
   */
  public getServices() {
    return {
      kernelService: this.getService<KernelService>('kernelService'),
      commService: this.getService<CommService>('commService'),
      imageTileService: this.getService<ImageTileService>('imageTileService'),
      featureTileService:
        this.getService<FeatureTileService>('featureTileService'),
      geocoderService: this.getService<GeocoderService>('geocoderService'),
      layerManager: this.getService<LayerManager>('layerManager'),
      imageManager: this.getService<ImageManager>('imageManager'),
      propertyInspectorManager: this.getService<PropertyInspectorManager>(
        'propertyInspectorManager'
      )
    };
  }

  /**
   * Register property inspector provider and wire up signals
   */
  public registerPropertyInspector(
    propertyInspectorProvider: IPropertyInspectorProvider,
    widget: any
  ): void {
    const propertyInspectorManager = this.getService<PropertyInspectorManager>(
      'propertyInspectorManager'
    );
    const imageManager = this.getService<ImageManager>('imageManager');
    const layerManager = this.getService<LayerManager>('layerManager');
    const featureTileService =
      this.getService<FeatureTileService>('featureTileService');

    // Set layer dependencies for property inspector manager
    propertyInspectorManager.setLayerDependencies(
      layerManager,
      featureTileService,
      () => imageManager.getCurrentImageName() || undefined
    );

    // Register with property inspector
    propertyInspectorManager.register(propertyInspectorProvider, widget);

    // Connect widget signals to property inspector manager
    widget.selectionChanged.connect(
      propertyInspectorManager.onSelectionChanged,
      propertyInspectorManager
    );
    widget.selectionCleared.connect(
      propertyInspectorManager.onSelectionCleared,
      propertyInspectorManager
    );

    // Connect ImageManager's enhanced signal directly to property inspector manager
    imageManager.imageChanged.connect(
      propertyInspectorManager.onImageInfoChanged,
      propertyInspectorManager
    );
  }

  /**
   * Dispose of all services
   */
  public dispose(): void {
    for (const [name, service] of this.services) {
      try {
        if (service && typeof service.dispose === 'function') {
          service.dispose();
        }
      } catch (error) {
        console.warn(`Error disposing service ${name}:`, error);
      }
    }
    this.services.clear();
    this.initialized = false;
  }
}

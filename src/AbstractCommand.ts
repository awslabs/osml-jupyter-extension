// Copyright Amazon.com, Inc. or its affiliates.

import { JupyterFrontEnd } from '@jupyterlab/application';
import { IToolbarWidgetRegistry } from '@jupyterlab/apputils';
import { IStatusBar } from '@jupyterlab/statusbar';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { ILoggerRegistry } from '@jupyterlab/logconsole';
import { IPropertyInspectorProvider } from '@jupyterlab/property-inspector';
import { Contents } from '@jupyterlab/services';
import { logger } from './utils';
import { ImageViewerWidget } from './ImageViewerWidget';
import { LayerControlToolbarButton, GeocoderToolbarWidget } from './components';
import { ServiceContainer } from './services';
import { Widget } from '@lumino/widgets';

/**
 * Shared widget state that can be accessed by all command instances
 */
export interface ISharedWidgetState {
  widget?: ImageViewerWidget;
  serviceContainer?: ServiceContainer;
}

/**
 * Abstract base class for commands that need to initialize and manage the ImageViewerWidget
 */
export abstract class AbstractCommand {
  constructor(
    protected app: JupyterFrontEnd,
    protected manager: any,
    protected browser: IFileBrowserFactory | null,
    protected loggerRegistry: ILoggerRegistry,
    protected propertyInspectorProvider: IPropertyInspectorProvider | null,
    protected toolbarRegistry: IToolbarWidgetRegistry | null,
    protected statusBar: IStatusBar | null,
    protected sharedState: ISharedWidgetState
  ) {}

  /**
   * Main execution method that follows the template pattern
   */
  async execute(): Promise<void> {
    const selectedFileName = this.getSelectedFileName();

    await this.initializeWidget();
    await this.executeCommandLogic(selectedFileName);
    this.attachAndActivateWidget();
    this.bindLogger();
  }

  /**
   * Get the currently selected file name from the file browser
   */
  protected getSelectedFileName(): string | null {
    const fileBrowserWidget = this.browser?.tracker.currentWidget;
    if (fileBrowserWidget) {
      const firstSelectedItem = fileBrowserWidget.selectedItems().next();
      return String(firstSelectedItem.value?.path);
    }
    return null;
  }

  /**
   * Initialize widget if it doesn't exist or is disposed
   */
  protected async initializeWidget(): Promise<void> {
    if (!this.sharedState.widget || this.sharedState.widget.isDisposed) {
      // Create and initialize service container
      this.sharedState.serviceContainer = new ServiceContainer(
        this.manager,
        this.propertyInspectorProvider || undefined
      );
      await this.sharedState.serviceContainer.initialize();

      // Create widget with service container
      this.sharedState.widget = new ImageViewerWidget(
        this.sharedState.serviceContainer
      );

      // Register with property inspector if available
      if (this.propertyInspectorProvider) {
        this.sharedState.serviceContainer.registerPropertyInspector(
          this.propertyInspectorProvider,
          this.sharedState.widget
        );
      }

      // Add toolbar items if toolbar registry is available
      this.setupToolbar();

      // Setup status bar if available
      this.setupStatusBar();
    }
  }

  /**
   * Setup toolbar items for the widget
   */
  protected setupToolbar(): void {
    if (
      this.toolbarRegistry &&
      this.sharedState.widget &&
      this.sharedState.widget.toolbar &&
      this.sharedState.serviceContainer
    ) {
      const services = this.sharedState.serviceContainer.getServices();

      // Create and add the layer control button with proper service injection
      const layerControlButton = new LayerControlToolbarButton(
        services.layerManager,
        services.featureTileService,
        () => {
          const currentImage = services.imageManager.getCurrentImage();
          return currentImage ? currentImage.name : undefined;
        }
      );
      this.sharedState.widget.toolbar.addItem(
        'layerControl',
        layerControlButton
      );

      // Create and add the geocoder toolbar widget
      const geocoderWidget = new GeocoderToolbarWidget(this.sharedState.widget);
      this.sharedState.widget.toolbar.addItem('geocoder', geocoderWidget);
    }
  }

  /**
   * Setup status bar for the widget
   */
  protected setupStatusBar(): void {
    if (this.statusBar && this.sharedState.widget) {
      const statusWidget = new Widget();
      statusWidget.node.textContent = 'OSML Image Viewer Starting...';
      const statusItem = this.statusBar.registerStatusItem(
        'osml-jupyter-extension:plugin',
        {
          align: 'middle',
          item: statusWidget
        }
      );
      this.sharedState.widget.statusSignal.connect((source, msg) => {
        statusWidget.node.textContent = msg;
      });
      this.sharedState.widget.disposed.connect(() => {
        statusItem.dispose();
      });
    }
  }

  /**
   * Attach widget to shell if not already attached and activate it
   */
  protected attachAndActivateWidget(): void {
    if (this.sharedState.widget) {
      if (!this.sharedState.widget.isAttached) {
        this.app.shell.add(this.sharedState.widget, 'main');
      }
      this.app.shell.activateById(this.sharedState.widget.id);
    }
  }

  /**
   * Bind logger to source logger registry
   */
  protected bindLogger(): void {
    // TODO: Fix the context here. Unclear what needs to be set to make
    // this context something other than ''. Would be great if we could
    // set it to the name of the image being viewed or the name of the
    // plugin.
    logger.bindToSourceLogger(this.loggerRegistry, '');
  }

  /**
   * Helper method to get selected files from the file browser
   */
  protected getSelectedFiles(): Contents.IModel[] {
    const widget = this.browser?.tracker.currentWidget;
    if (!widget) {
      return [];
    }
    return Array.from(widget.selectedItems());
  }

  /**
   * Public method to check if this command should be visible based on selected files
   */
  public isVisible(): boolean {
    const selectedFiles = this.getSelectedFiles();
    return this.checkVisibility(selectedFiles);
  }

  /**
   * Abstract method that subclasses must implement for their specific logic
   */
  protected abstract executeCommandLogic(
    selectedFileName: string | null
  ): Promise<void>;

  /**
   * Abstract method that subclasses must implement to define visibility rules
   */
  protected abstract checkVisibility(selectedFiles: Contents.IModel[]): boolean;
}

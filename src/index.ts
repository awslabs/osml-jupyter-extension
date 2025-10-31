// Copyright Amazon.com, Inc. or its affiliates.

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ICommandPalette, IToolbarWidgetRegistry } from '@jupyterlab/apputils';
import { ILauncher } from '@jupyterlab/launcher';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStatusBar } from '@jupyterlab/statusbar';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { ILoggerRegistry } from '@jupyterlab/logconsole';
import { IPropertyInspectorProvider } from '@jupyterlab/property-inspector';
import { LOGO_ICON, logger } from './utils';
import { ImageViewerWidget } from './ImageViewerWidget';
import { LayerControlToolbarButton, GeocoderToolbarWidget } from './components';
import { ServiceContainer } from './services';
import { Widget } from '@lumino/widgets';

namespace CommandIDs {
  export const openWithViewer = 'osml-jupyter-extension:openWithViewer';
  export const addLayer = 'osml-jupyter-extension:addLayer';
}
/**
 * Initialization data for the osml-jupyter-extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'osml-jupyter-extension:plugin',
  description:
    'A JupyterLab extension to work with satellite imagery using OversightML.',
  autoStart: true,
  requires: [ICommandPalette, ILoggerRegistry],
  optional: [
    ISettingRegistry,
    ILauncher,
    IFileBrowserFactory,
    IStatusBar,
    IToolbarWidgetRegistry,
    IPropertyInspectorProvider
  ],
  activate: activate
};

async function activate(
  app: JupyterFrontEnd,
  palette: ICommandPalette,
  loggerRegistry: ILoggerRegistry,
  settingRegistry: ISettingRegistry | null,
  launcher: ILauncher | null,
  browser: IFileBrowserFactory | null,
  statusBar: IStatusBar | null,
  toolbarRegistry: IToolbarWidgetRegistry | null,
  propertyInspectorProvider: IPropertyInspectorProvider | null
): Promise<void> {
  // Note: Logger initialization moved to ImageViewerWidget creation
  // to ensure log console infrastructure is ready

  const manager = app.serviceManager;
  let widget: ImageViewerWidget;
  let serviceContainer: ServiceContainer;

  app.commands.addCommand(CommandIDs.openWithViewer, {
    label: 'OversightML: Open',
    icon: LOGO_ICON,
    execute: async () => {
      let selectedFileName: string | null = null;
      const fileBrowserWidget = browser?.tracker.currentWidget;
      if (fileBrowserWidget) {
        const firstSelectedItem = fileBrowserWidget.selectedItems().next();
        selectedFileName = String(firstSelectedItem.value?.path);
      }

      // Regenerate the widget if disposed
      if (!widget || widget.isDisposed) {
        // Create and initialize service container
        serviceContainer = new ServiceContainer(
          manager,
          propertyInspectorProvider || undefined
        );
        await serviceContainer.initialize();

        // Create widget with service container
        widget = new ImageViewerWidget(serviceContainer);

        // If an image was selected, load it via ImageManager (which will trigger signals)
        if (selectedFileName) {
          try {
            widget.statusSignal.emit(`Loading ${selectedFileName} ...`);

            // Get services from container
            const services = serviceContainer.getServices();
            const { imageManager } = services;

            // Use ImageManager to load the image - this will handle all tile service operations internally
            await imageManager.loadImage(selectedFileName);

            logger.info(
              `Image ${selectedFileName} loaded successfully via command.`
            );
          } catch (error: any) {
            logger.error(
              `Failed to load image ${selectedFileName}: ${error.message}`
            );
            console.error('Error loading image:', error);
            widget.statusSignal.emit(
              `Error loading ${selectedFileName}: ${error.message}`
            );
          }
        }

        // Register with property inspector if available - this is now handled by ServiceContainer
        if (propertyInspectorProvider) {
          serviceContainer.registerPropertyInspector(
            propertyInspectorProvider,
            widget
          );
        }

        // Add toolbar items if toolbar registry is available
        if (toolbarRegistry && widget.toolbar) {
          // Get services from container
          const services = serviceContainer.getServices();

          // Create and add the layer control button with proper service injection
          const layerControlButton = new LayerControlToolbarButton(
            services.layerManager,
            services.featureTileService,
            () => (widget as any).imageName // Access current image name via closure
          );
          widget.toolbar.addItem('layerControl', layerControlButton);

          // Create and add the model selection button
          //const modelSelectionButton = new ModelSelectionToolbarButton(widget);
          //widget.toolbar.addItem('modelSelection', modelSelectionButton);

          // Create and add the geocoder toolbar widget
          const geocoderWidget = new GeocoderToolbarWidget(widget);
          widget.toolbar.addItem('geocoder', geocoderWidget);
        }
        if (statusBar) {
          const statusWidget = new Widget();
          statusWidget.node.textContent = 'OSML Image Viewer Starting...';
          const statusItem = statusBar.registerStatusItem(
            'osml-jupyter-extension:plugin',
            {
              align: 'middle',
              item: statusWidget
            }
          );
          widget.statusSignal.connect((source, msg) => {
            statusWidget.node.textContent = msg;
          });
          widget.disposed.connect(() => {
            statusItem.dispose();
          });
        }
      } else {
        // Load the selected image if widget already exists
        if (selectedFileName) {
          try {
            widget.statusSignal.emit(`Loading ${selectedFileName} ...`);

            // Get services from container
            const services = serviceContainer.getServices();
            const { imageManager } = services;

            // Use ImageManager to load the image - this will handle all tile service operations internally
            await imageManager.loadImage(selectedFileName);

            logger.info(
              `Image ${selectedFileName} loaded successfully via command.`
            );
          } catch (error: any) {
            logger.error(
              `Failed to load image ${selectedFileName}: ${error.message}`
            );
            console.error('Error loading image:', error);
            widget.statusSignal.emit(
              `Error loading ${selectedFileName}: ${error.message}`
            );
          }
        }
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there already
        app.shell.add(widget, 'main');
      }
      // Activate the widget
      app.shell.activateById(widget.id);

      // TODO: Fix the context here. Unclear what needs to be set to make
      // this context something other than ''. Would be great if we could
      // set it to the name of the image being viewed or the name of the
      // plugin.
      logger.bindToSourceLogger(loggerRegistry, '');
    }
  });

  app.commands.addCommand(CommandIDs.addLayer, {
    label: 'OversightML: Add Layer',
    icon: LOGO_ICON,
    execute: async () => {
      let selectedFileName: string | null = null;
      const fileBrowserWidget = browser?.tracker.currentWidget;
      if (fileBrowserWidget) {
        const firstSelectedItem = fileBrowserWidget.selectedItems().next();
        selectedFileName = String(firstSelectedItem.value?.path);
      }

      // Validate layer file selection
      if (!selectedFileName) {
        console.error('Layer addition failed - no layer file selected');
        return;
      }

      // Create the widget if it doesn't exist or is disposed
      if (!widget || widget.isDisposed) {
        // Create and initialize service container
        serviceContainer = new ServiceContainer(
          manager,
          propertyInspectorProvider || undefined
        );
        await serviceContainer.initialize();

        // Create widget with service container
        widget = new ImageViewerWidget(serviceContainer);

        // Register with property inspector if available - this is now handled by ServiceContainer
        if (propertyInspectorProvider) {
          serviceContainer.registerPropertyInspector(
            propertyInspectorProvider,
            widget
          );
        }

        // Add toolbar items if toolbar registry is available
        if (toolbarRegistry && widget.toolbar) {
          // Get services from container
          const services = serviceContainer.getServices();

          // Create and add the layer control button with proper service injection
          const layerControlButton = new LayerControlToolbarButton(
            services.layerManager,
            services.featureTileService,
            () => {
              const currentImage = services.imageManager.getCurrentImage();
              return currentImage ? currentImage.name : undefined;
            }
          );
          widget.toolbar.addItem('layerControl', layerControlButton);

          // Create and add the geocoder toolbar widget
          const geocoderWidget = new GeocoderToolbarWidget(widget);
          widget.toolbar.addItem('geocoder', geocoderWidget);
        }
        if (statusBar) {
          const statusWidget = new Widget();
          statusWidget.node.textContent = 'OSML Image Viewer Starting...';
          const statusItem = statusBar.registerStatusItem(
            'osml-jupyter-extension:plugin',
            {
              align: 'middle',
              item: statusWidget
            }
          );
          widget.statusSignal.connect((source, msg) => {
            statusWidget.node.textContent = msg;
          });
          widget.disposed.connect(() => {
            statusItem.dispose();
          });
        }
      }

      // Get services from container
      const services = serviceContainer.getServices();
      const { layerManager, featureTileService, imageManager } = services;

      // Validate that an image is loaded
      const currentImage = imageManager.getCurrentImage();
      if (!currentImage) {
        const errorMessage =
          'Error: No image loaded. Please open an image first before adding layers.';
        widget.statusSignal.emit(errorMessage);
        logger.error('Layer addition failed - no image loaded');
        return;
      }

      try {
        widget.statusSignal.emit(`Loading overlay from ${selectedFileName}...`);

        const loadResponse = await featureTileService.loadOverlay(
          currentImage.name,
          selectedFileName
        );

        // Check if the overlay load was successful
        if (!loadResponse.success) {
          const errorMessage = `Error: ${selectedFileName} could not be loaded as an overlay layer${loadResponse.error ? ` - ${loadResponse.error}` : ''}`;
          widget.statusSignal.emit(errorMessage);
          logger.error(
            `Failed to load overlay ${selectedFileName}: ${loadResponse.error || 'Unknown error'}`
          );
          return;
        }

        widget.statusSignal.emit(
          `Loading overlay from ${selectedFileName}... ${loadResponse.status}`
        );

        // Create feature tile data function
        const getFeatureTileData = featureTileService.createFeatureDataFunction(
          currentImage.name,
          selectedFileName
        );

        // Add the feature layer via LayerManager - signal will automatically update deck layers
        layerManager.addFeatureLayer(selectedFileName, getFeatureTileData);

        widget.statusSignal.emit(`Added overlay layer: ${selectedFileName}`);
        logger.info(`Layer added successfully: ${selectedFileName}`);
      } catch (error: any) {
        logger.error(
          `Failed to add layer ${selectedFileName}: ${error.message}`
        );
        console.error('Error loading overlay:', error);
        widget.statusSignal.emit(
          `Error loading overlay ${selectedFileName}: ${error.message}`
        );
        return;
      }

      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there already
        app.shell.add(widget, 'main');
      }
      // Activate the widget
      app.shell.activateById(widget.id);

      // TODO: Fix the context here. Unclear what needs to be set to make
      // this context something other than ''. Would be great if we could
      // set it to the name of the image being viewed or the name of the
      // plugin.
      logger.bindToSourceLogger(loggerRegistry, '');
    }
  });

  app.contextMenu.addItem({
    command: CommandIDs.openWithViewer,
    selector: '.jp-DirListing-item[data-isdir="false"]',
    rank: 2
  });
  app.contextMenu.addItem({
    command: CommandIDs.addLayer,
    selector: '.jp-DirListing-item[data-isdir="false"]',
    rank: 2
  });

  if (settingRegistry) {
    settingRegistry
      .load(plugin.id)
      .then(settings => {})
      .catch(reason => {
        console.error(
          'Failed to load settings for osml-jupyter-plugin.',
          reason
        );
      });
  }
}

export default plugin;

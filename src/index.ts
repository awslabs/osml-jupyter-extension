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
import {
  ModelSelectionToolbarButton,
  LayerControlToolbarButton,
  GeocoderToolbarWidget
} from './components';
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

  // Register toolbar items if toolbar registry is available
  if (toolbarRegistry) {
    // Register the model selection toolbar button factory
    toolbarRegistry.addFactory<ImageViewerWidget>(
      'ImageViewer',
      'modelSelection',
      (widget: ImageViewerWidget) => {
        return new ModelSelectionToolbarButton(widget);
      }
    );
  }

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
        widget = await ImageViewerWidget.createInstance(
          manager,
          selectedFileName
        );

        // Register with property inspector if available
        if (propertyInspectorProvider) {
          widget.registerWithPropertyInspector(propertyInspectorProvider);
        }

        // Add toolbar items if toolbar registry is available
        if (toolbarRegistry && widget.toolbar) {
          // Create and add the layer control button
          const layerControlButton = new LayerControlToolbarButton(widget);
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
        await widget.openImage(selectedFileName);
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

      // Create the widget if it doesn't exist or is disposed
      if (!widget || widget.isDisposed) {
        widget = await ImageViewerWidget.createInstance(
          manager,
          null // No image - widget will handle this in addLayer
        );

        // Register with property inspector if available
        if (propertyInspectorProvider) {
          widget.registerWithPropertyInspector(propertyInspectorProvider);
        }

        // Add toolbar items if toolbar registry is available
        if (toolbarRegistry && widget.toolbar) {
          // Create and add the layer control button
          const layerControlButton = new LayerControlToolbarButton(widget);
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

      // Always try to add the layer - let the widget handle the error if no image is loaded
      await widget.addLayer(selectedFileName);

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

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
import { LOGO_ICON } from './utils';
import { ImageViewerWidget } from './ImageViewerWidget';
import {
  ModelSelectionToolbarButton,
  ImageMetadataToolbarButton
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
  requires: [ICommandPalette],
  optional: [
    ISettingRegistry,
    ILauncher,
    IFileBrowserFactory,
    IStatusBar,
    IToolbarWidgetRegistry
  ],
  activate: activate
};

async function activate(
  app: JupyterFrontEnd,
  palette: ICommandPalette,
  settingRegistry: ISettingRegistry | null,
  launcher: ILauncher | null,
  browser: IFileBrowserFactory | null,
  statusBar: IStatusBar | null,
  toolbarRegistry: IToolbarWidgetRegistry | null
): Promise<void> {
  console.log('JupyterLab extension osml-jupyter-elt is activated!');

  const manager = app.serviceManager;
  let widget: ImageViewerWidget;

  // Register toolbar items if toolbar registry is available
  if (toolbarRegistry) {
    console.log('Registering toolbar items for ImageViewerWidget');

    // Register the model selection toolbar button factory
    toolbarRegistry.addFactory<ImageViewerWidget>(
      'ImageViewer',
      'modelSelection',
      (widget: ImageViewerWidget) => {
        console.log('Creating ModelSelectionToolbarButton for widget');
        return new ModelSelectionToolbarButton(widget);
      }
    );

    // Register the image metadata toolbar button factory
    toolbarRegistry.addFactory<ImageViewerWidget>(
      'ImageViewer',
      'imageMetadata',
      (widget: ImageViewerWidget) => {
        console.log('Creating ImageMetadataToolbarButton for widget');
        return new ImageMetadataToolbarButton(widget);
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
        console.log(
          `Creating new OSML ImageViewerWidget for ${selectedFileName}`
        );
        widget = await ImageViewerWidget.createForImage(
          manager,
          selectedFileName
        );

        // Add toolbar items if toolbar registry is available
        if (toolbarRegistry && widget.toolbar) {
          console.log('Adding toolbar items to ImageViewerWidget');

          // Create and add the model selection button
          //const modelSelectionButton = new ModelSelectionToolbarButton(widget);
          //widget.toolbar.addItem('modelSelection', modelSelectionButton);

          // Create and add the image metadata button
          const imageMetadataButton = new ImageMetadataToolbarButton(widget);
          widget.toolbar.addItem('imageMetadata', imageMetadataButton);
        }
        if (statusBar) {
          console.log('StatusBar found. Setting up status widget.');
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
            console.log('StatusWidget handler:');
            console.log(msg);
            statusWidget.node.textContent = msg;
          });
          widget.disposed.connect(() => {
            statusItem.dispose();
          });
        }
      } else {
        console.log(
          `OSML ImageViewerWidget Exists. Opening ${selectedFileName}`
        );
        await widget.openImage(selectedFileName);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there already
        console.log('Attaching OSML ImageViewerWidget to main');
        app.shell.add(widget, 'main');
      }
      // Activate the widget
      console.log('Activating OSML ImageViewerWidget');
      app.shell.activateById(widget.id);
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
        console.log('Creating new OSML ImageViewerWidget for layer addition');
        widget = await ImageViewerWidget.createForImage(
          manager,
          null // No image - widget will handle this in addLayer
        );

        // Add toolbar items if toolbar registry is available
        if (toolbarRegistry && widget.toolbar) {
          console.log('Adding toolbar items to ImageViewerWidget');

          // Create and add the image metadata button
          const imageMetadataButton = new ImageMetadataToolbarButton(widget);
          widget.toolbar.addItem('imageMetadata', imageMetadataButton);
        }
        if (statusBar) {
          console.log('StatusBar found. Setting up status widget.');
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
            console.log('StatusWidget handler:');
            console.log(msg);
            statusWidget.node.textContent = msg;
          });
          widget.disposed.connect(() => {
            statusItem.dispose();
          });
        }
      }

      // Always try to add the layer - let the widget handle the error if no image is loaded
      console.log(
        `OSML ImageViewerWidget available. Adding layer ${selectedFileName}`
      );
      await widget.addLayer(selectedFileName);

      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there already
        console.log('Attaching OSML ImageViewerWidget to main');
        app.shell.add(widget, 'main');
      }
      // Activate the widget
      console.log('Activating OSML ImageViewerWidget');
      app.shell.activateById(widget.id);
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
      .then(settings => {
        console.log('osml-jupyter-elt settings loaded:', settings.composite);
      })
      .catch(reason => {
        console.error('Failed to load settings for osml-jupyter-elt.', reason);
      });
  }
}

export default plugin;

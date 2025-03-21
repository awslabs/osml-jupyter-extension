import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ICommandPalette } from '@jupyterlab/apputils';
import { ILauncher } from '@jupyterlab/launcher';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { LOGO_ICON } from './icons';
import { ImageViewerWidget } from './ImageViewerWidget';

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
  optional: [ISettingRegistry, ILauncher, IFileBrowserFactory],
  activate: activate
};

async function activate(
  app: JupyterFrontEnd,
  palette: ICommandPalette,
  settingRegistry: ISettingRegistry | null,
  launcher: ILauncher | null,
  browser: IFileBrowserFactory | null
): Promise<void> {
  console.log('JupyterLab extension osml-jupyter-elt is activated!');

  const manager = app.serviceManager;
  let widget: ImageViewerWidget;

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
        widget = new ImageViewerWidget(manager, selectedFileName);
      } else {
        console.log(
          `OSML ImageViewerWidget Exists. Opening ${selectedFileName}`
        );
        widget.openImage(selectedFileName);
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

      // Regenerate the widget if disposed
      if (!widget || widget.isDisposed) {
        console.log('No ImageViewerWidget. Exiting!');
        return;
      } else {
        console.log(
          `OSML ImageViewerWidget Exists. Opening ${selectedFileName}`
        );
        widget.addLayer(selectedFileName);
      }
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

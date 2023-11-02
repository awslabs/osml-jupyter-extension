import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ICommandPalette } from '@jupyterlab/apputils';
import { ILauncher } from '@jupyterlab/launcher';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { LOGO_ICON } from './icons';
import { ImageViewerWidget } from './ImageViewerWidget';

namespace CommandIDs {
  export const launchViewer = 'osml-jupyter-extension:launchViewer';
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
  optional: [ISettingRegistry, ILauncher],
  activate: activate
};

async function activate(
  app: JupyterFrontEnd,
  palette: ICommandPalette,
  settingRegistry: ISettingRegistry | null,
  launcher: ILauncher | null
): Promise<void> {
  console.log('JupyterLab extension osml-jupyter-elt is activated!');

  const manager = app.serviceManager;
  const category: string = 'OversightML';
  let widget: ImageViewerWidget;

  // Add the application command
  app.commands.addCommand(CommandIDs.launchViewer, {
    label: 'OversightML Image Viewer',
    icon: LOGO_ICON,
    execute: async () => {
      // Regenerate the widget if disposed
      if (!widget || widget.isDisposed) {
        widget = new ImageViewerWidget(manager);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there already
        app.shell.add(widget, 'main');
      }
      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the commands to the palette.
  [CommandIDs.launchViewer].forEach(command => {
    palette.addItem({ command, category: category });
  });

  if (launcher) {
    launcher.add({
      command: CommandIDs.launchViewer,
      category: 'Other'
    });
  }

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

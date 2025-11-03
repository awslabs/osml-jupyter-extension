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
import { LOGO_ICON } from './utils';
import { ISharedWidgetState } from './AbstractCommand';
import { OpenImageCommand } from './OpenImageCommand';
import { AddLayerCommand } from './AddLayerCommand';

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

  // Create shared state object that both commands will use
  const sharedState: ISharedWidgetState = {};

  // Create command instances with all required dependencies including shared state
  const openImageCommand = new OpenImageCommand(
    app,
    manager,
    browser,
    loggerRegistry,
    propertyInspectorProvider,
    toolbarRegistry,
    statusBar,
    sharedState
  );

  const addLayerCommand = new AddLayerCommand(
    app,
    manager,
    browser,
    loggerRegistry,
    propertyInspectorProvider,
    toolbarRegistry,
    statusBar,
    sharedState
  );

  // Register commands using the command instances
  app.commands.addCommand(CommandIDs.openWithViewer, {
    label: 'OversightML: Open',
    icon: LOGO_ICON,
    execute: () => openImageCommand.execute()
  });

  app.commands.addCommand(CommandIDs.addLayer, {
    label: 'OversightML: Add Layer',
    icon: LOGO_ICON,
    execute: () => addLayerCommand.execute()
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

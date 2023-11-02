import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

/**
 * Initialization data for the osml-jupyter-extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'osml-jupyter-extension:plugin',
  description: 'A JupyterLab extension to work with satellite imagery using OversightML.',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: (app: JupyterFrontEnd, settingRegistry: ISettingRegistry | null) => {
    console.log('JupyterLab extension osml-jupyter-extension is activated!');

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('osml-jupyter-extension settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error('Failed to load settings for osml-jupyter-extension.', reason);
        });
    }
  }
};

export default plugin;

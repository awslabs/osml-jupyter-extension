// Copyright Amazon.com, Inc. or its affiliates.

import { LabIcon, codeIcon, listIcon } from '@jupyterlab/ui-components';

import COLOR_LOGO from '../../style/icons/logo-color.svg';

export const LOGO_ICON = new LabIcon({
  name: 'osml-jupyter-extension::logo',
  svgstr: COLOR_LOGO
});

// Re-export commonly used JupyterLab icons for consistency
export { codeIcon, listIcon };

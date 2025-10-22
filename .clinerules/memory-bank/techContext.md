# Technical Context: OSML Jupyter Extension

## Technology Stack

### Frontend Technologies
- **TypeScript**: Primary language for extension development
- **JupyterLab 4.0+**: Extension platform and framework
  - https://jupyterlab.readthedocs.io/en/4.4.x/extension/extension_dev.html#
- **Deck.gl**: GPU-powered high powered data visualization framework
  - https://github.com/visgl/deck.gl/tree/master/docs/api-reference
- **Lumino**: Widget framework underlying JupyterLab (signals, messaging, widgets)
  - https://lumino.readthedocs.io/en/latest/api/index.html

### Backend Technologies
- **Python 3.12**: Backend processing language
- **GDAL 3.8.5**: Geospatial Data Abstraction Library for raster processing
  - https://gdal.org/en/stable/api/python/index.html
- **Proj 9.4.1**: Cartographic projections library
- **OSML Imagery Toolkit**: Core satellite imagery processing capabilities
  - https://awslabs.github.io/osml-imagery-toolkit/
- **Jupyter Kernel**: Python execution environment with comm channel support

### Build and Development Tools
- **Node.js 18**: JavaScript runtime for build tools
- **TypeScript Compiler**: Code compilation and type checking
- **Jest**: JavaScript testing framework
- **Playwright**: End-to-end testing via Galata
- **ESLint/Prettier**: Code linting and formatting
- **Yarn/jlpm**: Package management

## Development Environment Setup
See the development build instructions in README.md

### Primary Development Environment
The project has a development environment defined using conda. See: conda/osml-jupyterlab-ext-dev-environment.yml

### Kernel Environment
The Jupyter kernel needs to be setup to include the dependencies defined
in conda/osml-kernel-environment.yml

## Architecture Constraints

### JupyterLab Integration
- Must follow JupyterLab extension patterns
- Requires proper plugin registration and lifecycle management
- Context menu integration with file browser
- Toolbar integration for main widget actions
- Status bar integration for user feedback

### Conda Environment Requirements
- GDAL and Proj versions must match between dev and kernel environments
- Python kernel must have osml-imagery-toolkit available
- Separate environments for development vs runtime

### Communication Protocol
- Jupyter comm channel for frontend-backend communication
- Custom message protocol for tile requests/responses
- Async/Promise-based communication patterns


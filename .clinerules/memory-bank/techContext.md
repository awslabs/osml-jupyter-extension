# Technical Context: OSML Jupyter Extension

## Technology Stack

### Frontend Technologies
- **TypeScript**: Primary language for extension development
- **JupyterLab 4.0+**: Extension platform and framework
- **Deck.gl**: GPU-powered high powered data visualization framework
- **Lumino**: Widget framework underlying JupyterLab (signals, messaging, widgets)

### Backend Technologies
- **Python 3.12.9**: Backend processing language
- **GDAL 3.8.5**: Geospatial Data Abstraction Library for raster processing
- **Proj 9.4.1**: Cartographic projections library
- **OSML Imagery Toolkit**: Core satellite imagery processing capabilities
- **Jupyter Kernel**: Python execution environment with comm channel support

### Build and Development Tools
- **Node.js 18**: JavaScript runtime for build tools
- **TypeScript Compiler**: Code compilation and type checking
- **Jest**: JavaScript testing framework
- **Playwright**: End-to-end testing via Galata
- **ESLint/Prettier**: Code linting and formatting
- **Yarn/jlpm**: Package management

## Development Environment Setup

### Primary Development Environment
```yaml
name: osml-jupyterlab-ext-dev
dependencies:
  - python=3.12.9
  - gdal=3.8.5
  - proj=9.4.1
  - jupyterlab=4
  - nodejs=18
  - pip:
    - osml-imagery-toolkit>=1.4.2
    - build, twine, hatch
```

### Kernel Environment
```yaml
name: osml-kernel
dependencies:
  - python=3.12.9
  - numpy=2.2.4
  - gdal=3.8.5
  - proj=9.4.1
  - ipykernel
  - geopandas
  - pip:
    - osml-imagery-toolkit>=1.4.2
    - boto3
```

## Key Dependencies

### Critical Runtime Dependencies
- **@jupyterlab/application**: Core JupyterLab application framework
- **@deck.gl/core**: Mapping and tile display functionality
- **osml-imagery-toolkit**: Satellite image processing backend

### Development Dependencies
- **@jupyterlab/builder**: Extension build system
- **@typescript-eslint**: TypeScript linting
- **webpack**: Module bundling

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

## Build System

### Development Workflow
```bash
# Development setup
conda env create -f environment.yml
conda activate osml-jupyterlab-ext-dev
pip install -e "."
jupyter labextension develop . --overwrite
jlpm install

# Development iteration
jlpm watch  # Auto-rebuild on changes
jupyter lab # Run in separate terminal
```

### Production Build
```bash
pip install build twine hatch
python3 -m build  # Creates wheel in ./dist
```

### Testing
- **Unit Tests**: Jest for TypeScript components
- **Integration Tests**: Playwright/Galata for end-to-end testing
- **Manual Testing**: Requires sample satellite imagery files

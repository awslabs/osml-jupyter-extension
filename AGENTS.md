# Sample AGENTS.md file

## Dev environment tips

- The build process follows the JupyterLab examples for packaging a prebuilt extension. Conda has been added to support complex dependencies like GDAL.
- Run `conda info` to check the active environment
- Run `conda activate osml-juipyterlab-ext-dev` to switch to the dev environment if needed.
- Run `conda env create -f conda/osml-jupyterlab-ext-dev-environment.yml` to set up the dev environment.
- Run `conda env create -f conda/osml-kernel-environment.yml` for the separate kernel environment
- Always run `jlpm install && jlpm build` after a new environment setup

## Build and test instructions

- Run `jlpm build` to build the extension
- Run `jlpm test:typescript` for frontend tests
- Run `jlpm test:python` for backend kernel tests
- Run `jlpm run lint` to enforce style checks. Some errors can be fixed automatically. Others will require intervention.
- The kernel code concatenation happens automatically during build but can be run manually with `python scripts/concat-kernel.py`

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

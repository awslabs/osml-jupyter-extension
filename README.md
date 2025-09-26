# osml_jupyter_extension

#### TEMP QUICK START GUIDE!!!
Note that this project is currently a quick and dirty proof of concept that does
not conform to any of the build conventions other OversightML projects use. It 
started from a jupyterlab extension template and was built to provide a proof of
concept. 

See the Development Install section below for ways to run this on a local developer
machine/jupyter instance for rapid dev iterations.

To build and install a binary into a SageMaker AI managed Jupyter environment follow
these instructions:
1. Build the code and package it as a wheel. The result ends up in the ./dist directory.
```bash
pip install build twine hatch
python3 -m build
```
2. Copy the .whl to your Jupyter instance.
3. Start a terminal on the Jupyter instance and then install the package:
```bash
python3 -m pip install osml_jupyter_extension-0.1.0-py3-none-any.whl
```
4. Verify that the installation succeeded. You should see a row that says osml-jupyter-extension enabled OK.
```bash
jupyter labextension list
```
5. Refresh/Reload your Jupyter browser window. This is necessary to download the new UI with the frontend extensions.

This extension assumes you have a conda based Jupyter kernel available with 
osml-imagery-toolkit available and installed. To do that:
1. Upload/create a Conda environment file to your Jupyter instance that has GDAL, Proj, and the osml-imagery-toolkit.
2. Start a terminal on the Jupyter instance and then create the conda environment:
```bash
conda env create -f osml-kernel-environment.yml
```
3. Register the new Conda environment as a Jupyter Kernel
```bash
conda activate osml-kernel
python3 -m ipykernel install --user --name=osml-kernel
```
4. Refresh/Reload your Jupyter browser window. This is necessary to make sure the new kernel is listed in the web UI.



[![Github Actions Status](https://github.com/aws-solutions-library-samples/osml-jupyter-extension/workflows/Build/badge.svg)](https://github.com/aws-solutions-library-samples/osml-jupyter-extension/actions/workflows/build.yml)
A JupyterLab extension to work with satellite imagery using OversightML.

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install osml_jupyter_extension
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall osml_jupyter_extension
```

## Contributing

### Development install

Setup development environment in conda. 
Make sure the gdal and proj dependencies in this environment match the dependencies in your 
osml-kernel environment
```bash
conda env create -f environment.yml
conda activate osml-jupyterlab-ext-dev
```

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment

# Install package in development mode
pip install -e "."
# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite


jlpm install

# Rebuild extension Typescript source after making changes
jlpm build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch
# Run JupyterLab in another terminal
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

### Development uninstall

```bash
pip uninstall osml_jupyter_extension
```

In development mode, you will also need to remove the symlink created by `jupyter labextension develop`
command. To find its location, you can run `jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `osml-jupyter-extension` within that folder.

### Testing the extension

#### Frontend tests

This extension is using [Jest](https://jestjs.io/) for JavaScript code testing.

To execute them, execute:

```sh
jlpm
jlpm test
```

#### Integration tests

This extension uses [Playwright](https://playwright.dev/docs/intro) for the integration tests (aka user level tests).
More precisely, the JupyterLab helper [Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata) is used to handle testing the extension in JupyterLab.

More information are provided within the [ui-tests](./ui-tests/README.md) README.

### Packaging the extension

See [RELEASE](RELEASE.md)

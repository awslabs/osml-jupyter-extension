# Project Brief: OSML Jupyter Extension

## Project Overview
The OSML Jupyter Extension is a JupyterLab extension designed to work with satellite imagery using OversightML. The project supports interactive visualization 
and analysis of satellite imagery directly within Jupyter notebooks. It is not expected to meet the full needs of imagery or geospatial analysts. Instead it
provides tools for the data science and engineering communities that help build tools for those analysts.

## Core Requirements
- **Primary Goal**: Provide satellite imagery visualization capabilities within JupyterLab
- **Target Users**: Data scientists, researchers, and engineers working with satellite imagery
- **Key Functionality**: 
  - Interactive image viewer with pan/zoom capabilities
  - Support for geospatial imagery formats including NITF, GeoTIFF, etc.
  - Ability to overlay geospatial features encoded in GeoJSON formats
  - Ability to overlay geospatial features created on the with a Jupyter Notebook

## Technical Foundation
- **Platform**: JupyterLab 4.0+ extension
- **Languages**: TypeScript (frontend), Python (backend integration)
- **Key Dependencies**: 
  - Deck.gl for mapping/imagery display
  - OSML Imagery Toolkit for satellite image processing
  - GDAL/Proj for geospatial operations
  - AWS SDK to interact with web services

## Project Status
- **Current State**: Release Candidate / Minimum Viable Product
- **Build Status**: Active development with CI/CD via GitHub Actions
- **Installation**: Available as Python wheel package
- **Environment**: Requires conda environment with GDAL, Proj, and osml-imagery-toolkit

## Key Constraints
- Must work within JupyterLab ecosystem
- Requires specific conda environment setup
- Currently focused on SageMaker AI managed Jupyter environments

## Success Criteria
- High performance rendering of large georeferenced images
- High performance overlay of large feature datasets
- Ability for users to easily access metadata describing both images and features
- 

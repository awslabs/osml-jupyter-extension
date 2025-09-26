# Project Brief: OSML Jupyter Extension

## Project Overview
The OSML Jupyter Extension is a JupyterLab extension designed to work with satellite imagery using OversightML. This is currently a proof-of-concept project that enables interactive visualization and analysis of satellite imagery directly within Jupyter notebooks.

## Core Requirements
- **Primary Goal**: Provide satellite imagery visualization capabilities within JupyterLab
- **Target Users**: Data scientists, researchers, and analysts working with satellite imagery
- **Key Functionality**: 
  - Open and display satellite imagery files (TIFF, NITF, etc.)
  - Layer management for overlaying multiple data sources
  - Interactive image viewer with pan/zoom capabilities
  - Integration with OSML imagery toolkit
  - Integration with SageMaker model endpoints

## Technical Foundation
- **Platform**: JupyterLab 4.0+ extension
- **Languages**: TypeScript (frontend), Python (backend integration)
- **Key Dependencies**: 
  - Leaflet for mapping/imagery display, (prototype to be replaced)
  - AWS Cloudscape Design System for UI components
  - OSML Imagery Toolkit for satellite image processing
  - GDAL/Proj for geospatial operations

## Project Status
- **Current State**: Proof of concept / early development
- **Build Status**: Active development with CI/CD via GitHub Actions
- **Installation**: Available as Python wheel package
- **Environment**: Requires conda environment with GDAL, Proj, and osml-imagery-toolkit

## Key Constraints
- Must work within JupyterLab ecosystem
- Requires specific conda environment setup
- Currently focused on SageMaker AI managed Jupyter environments
- Proof-of-concept status means build conventions may not match other OversightML projects

## Success Criteria
- Successfully display satellite imagery in JupyterLab
- Enable layer management and overlay capabilities
- Enable visualization of results from SageMaker Model Endpoints
- Provide intuitive user interface for image analysis
- Integrate seamlessly with existing Jupyter workflows
- Support common satellite image formats (TIFF, NITF, etc.)

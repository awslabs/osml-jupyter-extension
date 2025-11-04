# OSML Jupyter Extension - Roadmap

This document outlines the planned features and capabilities for future releases of the OSML Jupyter Extension.

## Current Status

The extension is currently in **Release Candidate/MVP** phase, with core functionality working and ready for community feedback. The following features are planned for future releases.

## Core Navigation & Interaction

### Elevation Models

Configure digital elevation models to improve geometric calculations and coordinate transformations. This will enhance the accuracy of coordinate conversions and overlay positioning, particularly important for imagery with significant terrain variation.

## Image Analysis & Processing

### Chipping

Select and extract portions of satellite imagery for detailed analysis or export. Users will be able to define regions of interest and extract them as separate image files for further processing.

### Pixel Histogram

Display statistical histograms of pixel values for each band, including minimum and maximum values. This feature will help users understand the data distribution and identify optimal display settings.

### Dynamic Range Adjustment (DRA)

Provide user-configurable controls for mapping raw pixel values to RGB display values. This will allow users to enhance contrast and visibility of features in different types of imagery.

### Band Selection

Enable users to choose specific bands and configure mappings for hyperspectral (HSI) and multispectral (MSI) imagery conversion to RGB display. This feature will support advanced analysis of multi-band datasets.

### Improved SICD DRA

Implement enhanced quarter power image calculations specifically for SICD (Synthetic Aperture Radar Complex Data) format tiles, providing better visualization of SAR imagery.

## Machine Learning Integration

### Run Model

Execute AWS SageMaker endpoints against selected regions of satellite imagery. This feature will enable users to run machine learning models directly on imagery tiles, supporting workflows like object detection, classification, and change detection.

### Model Result Visualization

Display and interact with machine learning model outputs, including bounding boxes, classification results, and segmentation masks overlaid on the source imagery.

## Interactive Editing

### Editing Overlays

Draw and edit geometric features directly on imagery, including points, lines, and polygons. This capability will support annotation workflows and ground truth creation for machine learning applications.

### Enhanced Layer Management

Advanced layer control and styling options, including layer opacity, color schemes, and filtering capabilities. Users will have fine-grained control over how multiple data layers are displayed and combined.

## Integration & Workflow Enhancements

### Notebook Integration Improvements

Enhanced bidirectional communication between the image viewer and Jupyter notebook cells, allowing for more seamless data exchange and programmatic control of the viewer.

### Export Capabilities

Export processed imagery, analysis results, and created annotations in various formats for use in other tools and workflows.

### Performance Optimizations

Continued improvements to tile loading, caching, and rendering performance, particularly for very large imagery datasets.

## Timeline

These features are being developed based on community feedback and use case priorities. The roadmap may be adjusted based on user needs and technical considerations.

For the most current information about planned features and development progress, see the project's GitHub issues and discussions.

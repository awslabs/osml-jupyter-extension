# Product Context: OSML Jupyter Extension

## Why This Project Exists
The OSML Jupyter Extension addresses a critical gap in satellite imagery analysis workflows. Data scientists and researchers working with satellite imagery need to:
- Visualize large, complex satellite image formats (TIFF, NITF) directly in their analysis environment
- Overlay multiple data layers for comparative analysis
- Maintain their existing Jupyter notebook workflows without switching tools
- Access specialized satellite imagery processing capabilities

## Problems It Solves
1. **Tool Fragmentation**: Eliminates the need to switch between Jupyter notebooks and external GIS tools
2. **Format Complexity**: Handles specialized satellite image formats that standard viewers cannot process
3. **Layer Management**: Provides intuitive overlay capabilities for multi-source analysis
4. **Workflow Integration**: Keeps imagery analysis within the familiar Jupyter environment

## How It Should Work
### Core User Experience
- **Right-click Integration**: Users can right-click on satellite image files in the Jupyter file browser and select "OversightML: Open" to launch the viewer
- **Layer Addition**: Additional layers can be added via "OversightML: Add Layer" context menu option
- **Interactive Viewing**: Pan, zoom, and explore imagery with deck.gl-based controls
- **Status Feedback**: Real-time status updates in the JupyterLab status bar

### Key Workflows
1. **Single Image Viewing**: Open a satellite image file for basic visualization and exploration
2. **Multi-layer Analysis**: Add multiple data sources as overlays for comparative analysis
3. **Integrated Analysis**: Use the viewer alongside notebook cells for combined visual and computational analysis

## User Experience Goals
- **Seamless Integration**: Feel like a native part of JupyterLab, not a separate tool
- **Intuitive Interface**: Leverage familiar mapping controls and AWS Cloudscape design patterns
- **Performance**: Handle large satellite imagery files efficiently
- **Accessibility**: Work within existing conda environments and kernel setups
- **Flexibility**: Support various satellite image formats commonly used in research

## Target Environment
- **Primary**: SageMaker AI managed Jupyter environments
- **Secondary**: Local developer Jupyter instances
- **Kernel Requirements**: Conda environment with GDAL, Proj, and osml-imagery-toolkit
- **User Personas**: Satellite imagery analysts, geospatial researchers, machine learning practitioners working with remote sensing data

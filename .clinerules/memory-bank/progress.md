# Progress: OSML Jupyter Extension

## What Works
- **Core Extension Structure**: JupyterLab extension is properly configured and builds successfully
- **ImageViewerWidget**: Main application window rendering through Deck.gl
- **Context Menu Integration**: Right-click "OversightML: Open" and "OversightML: Add Layer" commands work
- **Comm Channel Communication**: Frontend-backend messaging via Jupyter comm system is functional
- **Tile Processing**: GDAL-based tile factory processes satellite imagery into web-compatible tiles
- **Layer System**: Base image layers and vector overlays can be added and managed
- **Status Updates**: Real-time status feedback through JupyterLab status bar
- **Resource Cleanup**: Proper disposal of sessions, comm channels, and map resources

## What's Left to Build
- **GeoJump**: Control that lets users center the view on a specific world coordinate
- **GeoLocate**: Click on an image and find out the world coordinates using a sensor model
- **Elevation Models**: Users can configure an elevation model to improve geo calculations
- **Chipping**: Let a user select and chip out a portion of an image
- **Pixel Histogram**: Display histogram of each pixel band with min/max
- **Run Model**: Let a user run a SageMaker endpoint against all the tiles in a selected region
- **DRA Adjustments**: User can adjust the dynamic range that maps raw image pixels to RGB
- **Band Select**: User can select bands and mappings for HSI/MSI imagery conversion to RGB
- **Improved SICD DRA**: SICD data uses quarter power image calculations for tiles
- **Editing Overlays**: Users can draw and edit geometries on an image

## Current Status
- **Development Phase**: Proof of concept with core functionality working
- **Build System**: Functional but non-standard due to proof-of-concept nature
- **Testing**: Basic manual testing with sample imagery files
- **Deployment**: Manual wheel-based installation for SageMaker environments

## Known Issues
- **Complex Kernel Code Build**: Backend kernel code has cumbersome concatination process.

## Evolution of Project Decisions
- **Started from Template**: Built upon JupyterLab extension cookiecutter template
- **Proof-of-Concept Focus**: Established feasability of tiles over comm channel architecture
- **Deck.gl Selection**: Selected over other mapping libraries for performance and features

## Recent Milestones
- ✅ Basic extension structure and build system
- ✅ Context menu integration with file browser
- ✅ ImageViewerWidget with Deck.gl TileLayer
- ✅ Comm channel setup and messaging protocol
- ✅ GDAL tile factory integration
- ✅ Status bar integration
- ✅ Resource cleanup and disposal

## Next Major Milestones
- 🔄 Improved unit testing
- 🔄 Refactor / cleanup messy AI generated code
- 🔄 Public release of extension

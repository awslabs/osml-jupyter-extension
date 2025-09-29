# Active Context: OSML Jupyter Extension

## Current Work Focus
**ImageViewerWidget Simplification**: Successfully refactored the ImageViewerWidget to use Deck.gl TileLayer directly, eliminating unnecessary wrapper classes while preserving flexible tile data loading capabilities.

## Recent Changes
- **Completed ImageViewerWidget Refactoring**: Simplified from complex wrapper architecture to direct TileLayer usage
- **Eliminated Wrapper Classes**: Identified ImagePyramidLayerManager and DeckTileImageLayer for removal
- **Preserved getTileData Flexibility**: Maintained ability to swap between mock and real tile data implementations
- **Fixed TypeScript Integration**: Properly handled TileLoadProps format for Deck.gl compatibility
- **Reduced Code Complexity**: Eliminated ~400 lines of wrapper code while maintaining all functionality

## Next Steps
1. **Remove Obsolete Files**: Delete `src/ImagePyramidLayerManager.ts` and `src/DeckTileImageLayer.ts`
2. **Update Import References**: Check for any remaining imports of removed classes
3. **Test Simplified Implementation**: Verify all functionality works with direct TileLayer approach
4. **Update Documentation**: Reflect architectural changes in system patterns

## Active Decisions and Considerations

### Project Understanding
- This is a proof-of-concept JupyterLab extension for satellite imagery visualization
- Uses TypeScript frontend with Python backend integration via Jupyter comm channels
- Leverages OSML imagery toolkit for satellite image processing
- Targets SageMaker AI managed Jupyter environments primarily

### Key Technical Insights
- Extension follows factory pattern for widget creation and tile processing
- Communication architecture uses Jupyter's comm system for frontend-backend messaging
- Performance optimized through tile caching and overview generation
- Requires specific conda environment setup with matching GDAL/Proj versions

### Important Patterns and Preferences
- AWS Cloudscape Design System for UI consistency
- Leaflet for interactive mapping capabilities
- Signal-based status updates for user feedback
- Proper resource cleanup and disposal patterns

## Current Development Environment
- **Primary Environment**: `osml-jupyterlab-ext-dev` conda environment
- **Kernel Environment**: `osml-kernel` conda environment
- **Key Dependencies**: JupyterLab 4.0+, TypeScript, Leaflet, OSML toolkit
- **Build System**: jlpm/yarn with TypeScript compilation

## Learnings and Project Insights
- Project started from JupyterLab extension template
- Build conventions may not match other OversightML projects due to proof-of-concept status
- Extension provides context menu integration for "OversightML: Open" and "OversightML: Add Layer"
- Single ImageViewerWidget instance management with proper lifecycle handling
- Custom CRS (Coordinate Reference System) implementation for image-specific coordinate space

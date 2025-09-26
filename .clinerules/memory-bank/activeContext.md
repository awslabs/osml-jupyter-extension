# Active Context: OSML Jupyter Extension

## Current Work Focus
**Memory Bank Initialization**: Setting up comprehensive documentation structure for the OSML Jupyter Extension project to enable effective context management across development sessions.

## Recent Changes
- Created complete memory bank directory structure under `.clinerules/memory-bank/`
- Established foundational documentation files:
  - `projectbrief.md`: Core project overview and requirements
  - `productContext.md`: User experience and problem definition
  - `systemPatterns.md`: Architecture and design patterns
  - `techContext.md`: Technology stack and development environment

## Next Steps
1. Complete memory bank initialization with `activeContext.md` and `progress.md`
2. Validate memory bank structure and content completeness
3. Ready for future development tasks with full context preservation

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

# Known Limitations and Issues

This document outlines current limitations, known issues, and important considerations when using the OSML Jupyter Extension.

## Development Status

### API Stability

- **Current Status**: Release Candidate/MVP phase
- **Impact**: APIs and interfaces may change in future releases
- **Recommendation**: Pin to specific versions in production environments and review release notes before upgrading

### Proof-of-Concept Architecture

- **Current Status**: Built as proof-of-concept with some non-standard patterns
- **Impact**: Some implementation details may be refactored in future versions
- **Recommendation**: Use feedback channels to report issues and suggest improvements

## Technical Limitations

### Complex Build Process

- **Issue**: Backend kernel code requires non-standard concatenation process
- **Details**: Python kernel modules are concatenated using `scripts/concat-kernel.py` due to proof-of-concept architecture
- **Impact**: Development workflow is more complex than typical JupyterLab extensions
- **Workaround**: Follow development setup instructions carefully; build system handles concatenation automatically

### Environment Dependencies

- **Issue**: Requires specific conda environment setup with exact version matching
- **Dependencies**: GDAL, Proj, and OSML Imagery Toolkit versions must align between development and kernel environments
- **Impact**: Setup is more involved than typical Python packages
- **Recommendation**: Use provided conda environment files (`conda/osml-kernel-environment.yml` and `conda/osml-jupyterlab-ext-dev-environment.yml`)

### Primary Target Environment

- **Optimization**: Designed primarily for AWS SageMaker AI managed Jupyter environments
- **Impact**: Other deployment scenarios may require additional configuration
- **Considerations**: Local installations work but may need environment adjustments

## Functional Limitations

### World Coordinate Accuracy

- **Current Implementation**: World coordinates are calculated using the image's sensor model without external elevation data
- **Impact**: Coordinate accuracy may be reduced, particularly in areas with significant terrain variation
- **Future Enhancement**: Integration with digital elevation models is planned to improve coordinate transformation accuracy

### Format Support

- **Current Support**: NITF, GeoTIFF, SICD, SIDD, and GeoJSON datasets
- **Limitation**: Some specialized satellite imagery formats may not be fully supported
- **Dependency**: Format support depends on underlying GDAL and OSML Toolkit capabilities

### Performance Considerations

- **Large Imagery**: Very large imagery files may experience slower initial loading
- **Memory Usage**: Complex overlay datasets may require significant memory
- **Recommendation**: Monitor system resources when working with large datasets

### Kernel Session Management

- **Requirement**: Extension requires kernel with specific dependencies installed
- **Impact**: Cannot work with arbitrary Python kernels
- **Setup**: Must use kernels with GDAL, Proj, and OSML Imagery Toolkit available

## Usage Scope

### Not a Full GIS Application

- **Design Intent**: Built for data scientists and engineers building tools for analysts
- **Limitation**: Does not replace full-featured GIS software
- **Use Case**: Best suited for satellite imagery processing within Jupyter workflows, not comprehensive geospatial analysis

### SageMaker Integration

- **Current Status**: Optimized for SageMaker environments
- **Limitation**: Some features may work differently in other Jupyter deployments
- **Recommendation**: Test thoroughly in non-SageMaker environments

## Reporting Issues

### Known Issue Categories

- **Build System**: Complex concatenation process may occasionally fail
- **Environment Setup**: Version mismatches between development and kernel environments
- **Memory Usage**: Large datasets may cause memory pressure
- **Compatibility**: Issues with specific Jupyter or JupyterLab versions

### Getting Help

- **GitHub Issues**: Report bugs and request features via GitHub repository
- **Documentation**: Check USER_GUIDE.md and ARCHITECTURE_OVERVIEW.md for additional context
- **Community**: Engage with the community through GitHub discussions

### Contributing Fixes

- **Development**: See CONTRIBUTING.md for guidelines on submitting fixes
- **Testing**: Both TypeScript and Python test suites available
- **Architecture**: Review ARCHITECTURE_OVERVIEW.md to understand system design

## Future Improvements

Many of these limitations are being addressed in future releases. See [ROADMAP.md](ROADMAP.md) for planned improvements and new capabilities.

The development team actively works to address these limitations while maintaining the core functionality that users depend on. Feedback and contributions are welcome to help prioritize improvements.

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

### Kernel Dependency Installation

- **Requirement**: On first use in a kernel, the extension installs its Python dependencies (`osml-imagery-toolkit`, `osml-imagery-io`, and the embedded kernel wheel) into that kernel's environment
- **Impact**: The kernel needs either outbound access to PyPI (via `pip`) or those dependencies pre-provisioned. In fully air-gapped kernels without pre-provisioned dependencies, the first-use bootstrap cannot complete.
- **Recommendation**: In connected environments no manual setup is required — the bootstrap runs automatically. For air-gapped or centrally managed deployments, pre-provision the kernel dependencies (see `conda/osml-kernel-environment.yml`) so the bootstrap completes without outbound network access.

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
- **Dependency**: Format support depends on the underlying `osml-imagery-toolkit` / `osml-imagery-io` capabilities

### Performance Considerations

- **Large Imagery**: Very large imagery files may experience slower initial loading
- **Memory Usage**: Complex overlay datasets may require significant memory
- **Recommendation**: Monitor system resources when working with large datasets

### Kernel Session Management

- **Requirement**: Extension requires a kernel with its Python dependencies installed
- **Impact**: Works with any Python kernel that has `pip` and PyPI access — the extension self-bootstraps its dependencies on first use
- **Setup**: No manual dependency installation is needed in connected environments. In air-gapped kernels, pre-provision `osml-imagery-toolkit` and `osml-imagery-io` (see `conda/osml-kernel-environment.yml`)

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

- **Kernel Bootstrap**: First-use dependency installation may fail in kernels without PyPI access (see air-gapped guidance above)
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

// Copyright Amazon.com, Inc. or its affiliates.

/**
 * Python kernel setup code for the OSML Jupyter Extension.
 *
 * This code is injected into the Jupyter kernel to provide:
 * - GDAL-based tile processing for satellite imagery
 * - Comm channel setup for frontend-backend communication
 * - Caching mechanisms for tile factories and overlay data
 * - Message handlers for image and overlay tile requests
 */

// The bootstrap is split into two Python files, both imported as raw strings:
//   - kernel-payload.generated.py — generated DATA (base64 wheel, sha256, version)
//   - kernel-bootstrap.py         — hand-maintained LOGIC (install + progress)
// The payload MUST come first so the bootstrap logic can read the _WHEEL_B64 /
// _WHEEL_SHA256 / _VERSION names it defines. See scripts/bundle-kernel.py.
import kernelPayloadPython from '../kernel/kernel-payload.generated.py';
import kernelBootstrapPython from '../kernel/kernel-bootstrap.py';

/**
 * The Python code that the extension installs in a newly launched kernel to provide access to raster and vector
 * tiles. The code itself is sent to the kernel by calling requestExecute() and as it runs it sets up the server side
 * of the comm messaging handlers. It is only a MVP prototype for now and we will need to look for best practices
 * about how to manage this code going forward.
 */
export const KERNEL_SETUP_CODE: string = `${kernelPayloadPython}\n\n${kernelBootstrapPython}`;

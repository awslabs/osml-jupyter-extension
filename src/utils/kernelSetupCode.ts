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

// Import the Python code as a string
import kernelSetupPython from '../kernel/kernel-setup.py';

/**
 * The Python code that the extension installs in a newly launched kernel to provide access to raster and vector
 * tiles. The code itself is sent to the kernel by calling requestExecute() and as it runs it sets up the server side
 * of the comm messaging handlers. It is only a MVP prototype for now and we will need to look for best practices
 * about how to manage this code going forward.
 */
export const KERNEL_SETUP_CODE: string = kernelSetupPython;

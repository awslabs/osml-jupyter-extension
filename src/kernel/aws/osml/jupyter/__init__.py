# Copyright Amazon.com, Inc. or its affiliates.

import os

__version__ = os.environ.get("OSML_KERNEL_VERSION", "0.0.0")

from aws.osml.jupyter.main import initialize
from aws.osml.jupyter.viewer import viewer, ViewerError

__all__ = ["initialize", "viewer", "ViewerError", "__version__"]

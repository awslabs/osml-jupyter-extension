# Copyright Amazon.com, Inc. or its affiliates.

# Model inference processors are stubs pending frontend UI wiring and
# SageMaker integration design. The original implementation required a boto3
# dependency (not declared in pyproject.toml) and was not connected to any
# frontend message flow. These classes preserve the message-type contract so
# the registry can register them and return a clear NOT_IMPLEMENTED response.

from aws.osml.jupyter.core import BaseMessageProcessor
from aws.osml.jupyter.responses import handle_errors_enhanced


class EndpointListProcessor(BaseMessageProcessor):
    """Process LIST_AVAILABLE_ENDPOINTS messages.

    Future implementation: list active SageMaker endpoints via boto3 and
    return them to the frontend for display in the model selection UI.
    """

    @handle_errors_enhanced('LIST_AVAILABLE_ENDPOINTS_RESPONSE', 'list_endpoints')
    def process(self, data, comm):
        raise NotImplementedError(
            "SageMaker endpoint listing is not yet implemented. "
            "This processor is a stub pending frontend UI integration."
        )


class ModelTileProcessor(BaseMessageProcessor):
    """Process MODEL_TILE_REQUEST messages.

    Future implementation: invoke a SageMaker endpoint with image tile data,
    parse GeoJSON detections from the response, cache results at zoom level 0,
    and aggregate/filter for higher zoom levels. Requires boto3 and a
    corresponding frontend tile layer that requests MODEL_TILE_REQUEST messages.
    """

    @handle_errors_enhanced('MODEL_TILE_RESPONSE', 'model_tile')
    def process(self, data, comm):
        raise NotImplementedError(
            "Model inference tile processing is not yet implemented. "
            "This processor is a stub pending SageMaker integration."
        )

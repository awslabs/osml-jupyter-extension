# Copyright Amazon.com, Inc. or its affiliates.

from aws.osml.jupyter.cache import AdvancedCacheManager
from aws.osml.jupyter.comm_registry import CommRegistry
from aws.osml.jupyter.core import OSMLKernelLogger
from aws.osml.jupyter.processors.registry import MessageHandlerRegistry
from aws.osml.jupyter.processors.image import (
    ImageLoadProcessor,
    ImageTileProcessor,
    ImageMetadataProcessor,
    ImageStatisticsProcessor,
    ImageUnloadProcessor,
)
from aws.osml.jupyter.processors.overlay import (
    OverlayTileProcessor,
    OverlayLoadProcessor,
    OverlayUnloadProcessor,
)
from aws.osml.jupyter.processors.model import EndpointListProcessor, ModelTileProcessor
from aws.osml.jupyter.processors.coordinates import ImageToWorldProcessor, WorldToImageProcessor
from aws.osml.jupyter.processors.pyramid import PyramidBuildProcessor
from aws.osml.jupyter.processors.view_state import (
    ViewStateUpdateProcessor,
    ClickEventProcessor,
)
from aws.osml.jupyter.responses import ResponseBuilder
from aws.osml.jupyter.view_state import ViewStateStore
from aws.osml.jupyter.viewer import viewer


def _build_registry(cache_manager, logger, view_state_store=None):
    if view_state_store is None:
        view_state_store = ViewStateStore()

    registry = MessageHandlerRegistry()

    registry.register('IMAGE_LOAD_REQUEST', ImageLoadProcessor(cache_manager, logger))
    registry.register('IMAGE_TILE_REQUEST', ImageTileProcessor(cache_manager, logger))
    registry.register('IMAGE_METADATA_REQUEST', ImageMetadataProcessor(cache_manager, logger))
    registry.register('IMAGE_STATISTICS_REQUEST', ImageStatisticsProcessor(cache_manager, logger))
    registry.register('IMAGE_UNLOAD_REQUEST', ImageUnloadProcessor(cache_manager, logger))

    registry.register('OVERLAY_TILE_REQUEST', OverlayTileProcessor(cache_manager, logger))
    registry.register('OVERLAY_LOAD_REQUEST', OverlayLoadProcessor(cache_manager, logger))
    registry.register('OVERLAY_UNLOAD_REQUEST', OverlayUnloadProcessor(cache_manager, logger))

    registry.register('LIST_AVAILABLE_ENDPOINTS', EndpointListProcessor(cache_manager, logger))
    registry.register('MODEL_TILE_REQUEST', ModelTileProcessor(cache_manager, logger))

    registry.register('IMAGE_TO_WORLD_REQUEST', ImageToWorldProcessor(cache_manager, logger))
    registry.register('WORLD_TO_IMAGE_REQUEST', WorldToImageProcessor(cache_manager, logger))

    registry.register('PYRAMID_BUILD_REQUEST', PyramidBuildProcessor(cache_manager, logger))

    registry.register('VIEW_STATE_UPDATE', ViewStateUpdateProcessor(view_state_store, logger))
    registry.register('CLICK_EVENT', ClickEventProcessor(view_state_store, logger))

    logger.info("Message processors initialized and registered")
    return registry


def _create_router(registry, logger):
    def make_handler(comm):
        def _recv(msg):
            message_data = None
            message_type = None
            try:
                message_data = msg['content']['data']
                message_type = message_data.get('type')

                if not message_type:
                    logger.error("Received message without type field")
                    return

                logger.debug(f"Processing message type: {message_type}")
                registry.handle(message_type, message_data, comm)
            except Exception as e:
                logger.log_error_detailed("message_processing", e, message_data)
                if message_type:
                    response = ResponseBuilder.error_response(
                        f"{message_type}_RESPONSE",
                        f"Message processing failed: {str(e)}",
                    )
                    comm.send(response)

        return _recv

    return make_handler


def initialize(ipython, force=False):
    """Initialize the kernel and register the comm target with IPython.

    Idempotent: subsequent calls are no-ops unless force=True.
    """
    global _initialized, _cache_manager, _logger, _registry, _comm_registry
    global _view_state_store

    if _initialized and not force:
        return

    _cache_manager = AdvancedCacheManager()
    _logger = OSMLKernelLogger()
    _view_state_store = ViewStateStore()
    _registry = _build_registry(_cache_manager, _logger, _view_state_store)
    _comm_registry = CommRegistry(_logger)

    viewer._bind(_view_state_store, _comm_registry, _cache_manager)

    make_handler = _create_router(_registry, _logger)

    def osml_comm_target_func(comm, msg):
        _comm_registry.register(comm)
        comm.on_close(lambda close_msg: _comm_registry.unregister(comm))
        handler = make_handler(comm)
        comm.on_msg(handler)
        comm.send({'type': 'KERNEL_COMM_SETUP_COMPLETE'})

    ipython.kernel.comm_manager.register_target('osml_comm_target', osml_comm_target_func)

    _logger.info("OSML Jupyter Extension kernel setup complete")
    _logger.info(f"Registered message types: {_registry.get_registered_message_types()}")

    _initialized = True


_initialized = False
_cache_manager = None
_logger = None
_registry = None
_comm_registry = None
_view_state_store = None

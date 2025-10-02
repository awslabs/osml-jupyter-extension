# Main initialization: Infrastructure setup and comm channel registration

# Initialize the global infrastructure components
global_cache_manager = AdvancedCacheManager()
global_logger = OSMLKernelLogger()
global_message_registry = MessageHandlerRegistry()

# Register message processors with the registry
def initialize_message_processors():
    """Initialize and register message processors"""
    # Create processor instances
    image_load_processor = ImageLoadProcessor(global_cache_manager, global_logger)
    image_tile_processor = ImageTileProcessor(global_cache_manager, global_logger)
    overlay_tile_processor = OverlayTileProcessor(global_cache_manager, global_logger)
    
    # Image metadata and lifecycle processors
    image_metadata_processor = ImageMetadataProcessor(global_cache_manager, global_logger)
    image_statistics_processor = ImageStatisticsProcessor(global_cache_manager, global_logger)
    image_unload_processor = ImageUnloadProcessor(global_cache_manager, global_logger)
    
    # Overlay lifecycle and ML/model inference processors
    overlay_load_processor = OverlayLoadProcessor(global_cache_manager, global_logger)
    overlay_unload_processor = OverlayUnloadProcessor(global_cache_manager, global_logger)
    endpoint_list_processor = EndpointListProcessor(global_cache_manager, global_logger)
    model_tile_processor = ModelTileProcessor(global_cache_manager, global_logger)
    
    # Register existing processors with the message registry
    global_message_registry.register('IMAGE_LOAD_REQUEST', image_load_processor)
    global_message_registry.register('IMAGE_TILE_REQUEST', image_tile_processor)
    global_message_registry.register('OVERLAY_TILE_REQUEST', overlay_tile_processor)
    
    # Register image metadata and lifecycle processors
    global_message_registry.register('IMAGE_METADATA_REQUEST', image_metadata_processor)
    global_message_registry.register('IMAGE_STATISTICS_REQUEST', image_statistics_processor)
    global_message_registry.register('IMAGE_UNLOAD_REQUEST', image_unload_processor)
    
    # Register overlay lifecycle and ML/model inference processors
    global_message_registry.register('OVERLAY_LOAD_REQUEST', overlay_load_processor)
    global_message_registry.register('OVERLAY_UNLOAD_REQUEST', overlay_unload_processor)
    global_message_registry.register('LIST_AVAILABLE_ENDPOINTS', endpoint_list_processor)
    global_message_registry.register('MODEL_TILE_REQUEST', model_tile_processor)
    
    global_logger.info("Message processors initialized and registered")

# Initialize message processors
initialize_message_processors()

# Global comm reference for debugging and diagnostics
osml_comm = None

def create_new_recv(comm):
    """New message handler that uses the message registry"""
    def _recv(msg):
        try:
            # Extract message data
            message_data = msg['content']['data']
            message_type = message_data.get('type')
            
            if not message_type:
                global_logger.error("Received message without type field")
                return
            
            global_logger.debug(f"Processing message type: {message_type}")
            
            # Use the message registry to handle the message
            global_message_registry.handle(message_type, message_data, comm)
            
        except Exception as e:
            global_logger.log_error_detailed("message_processing", e, message_data if 'message_data' in locals() else None)
            # Send generic error response if we can determine the expected response type
            if 'message_type' in locals() and message_type:
                response = ResponseBuilder.error_response(
                    f"{message_type}_RESPONSE",
                    f"Message processing failed: {str(e)}"
                )
                comm.send(response)
    
    return _recv

def osml_comm_target_func(comm, msg):
    """Main comm target function for handling frontend communication"""
    global osml_comm
    # comm is the kernel Comm instance
    # msg is the comm_open message

    osml_comm = comm
    
    # Register handler for later messages using new registry-based system
    comm.on_msg(create_new_recv(comm))
    
    # Also register legacy handler for backward compatibility (fallback)
    # This allows gradual migration and testing
    # comm.on_msg(create_recv(comm))  # Commented out to use new system

    # Send data to the frontend
    comm.send({'type': "KERNEL_COMM_SETUP_COMPLETE"})

# Register the communication target with IPython kernel
get_ipython().kernel.comm_manager.register_target('osml_comm_target', osml_comm_target_func)

# Log successful initialization
global_logger.info("OSML Jupyter Extension kernel setup complete")
global_logger.info(f"Registered message types: {get_registered_message_types()}")
global_logger.info("Using new message processor architecture")

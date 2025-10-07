# Message processor registry: Central registry for mapping message types to processors

import time

class MessageHandlerRegistry:
    """Central registry for mapping message types to processors"""
    
    def __init__(self):
        self.handlers = {}
        self.performance_monitor = PerformanceMonitor()
        self.logger = OSMLKernelLogger()
    
    def register(self, message_type, processor):
        """Register a message processor for a message type"""
        self.handlers[message_type] = processor
        self.logger.info(f"Registered handler for message type: {message_type}")
    
    def handle(self, message_type, message_data, comm):
        """Handle a message using the appropriate processor"""
        start_time = time.time()
        
        handler = self.handlers.get(message_type)
        if handler:
            try:
                result = handler.process(message_data, comm)
                processing_time = time.time() - start_time
                self.performance_monitor.track_request(message_type, processing_time)
                return result
            except Exception as e:
                self.performance_monitor.track_error(message_type)
                raise e
        else:
            return self._handle_unknown_message(message_type, message_data, comm)
    
    def _handle_unknown_message(self, message_type, message_data, comm):
        """Handle unknown message types"""
        error_msg = f"Unknown message type: {message_type}"
        self.logger.error(error_msg)
        
        response = ResponseBuilder.error_response(
            f"{message_type}_RESPONSE", 
            error_msg,
            "UNKNOWN_MESSAGE_TYPE"
        )
        comm.send(response)
    
    def get_performance_stats(self):
        """Get performance statistics"""
        return self.performance_monitor.get_stats()
    
    def get_registered_message_types(self):
        """Get list of registered message types"""
        return list(self.handlers.keys())

def get_registered_message_types():
    """Get list of registered message types from global registry"""
    return global_message_registry.get_registered_message_types()

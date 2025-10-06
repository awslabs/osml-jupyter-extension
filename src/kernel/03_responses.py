# Response building: ResponseBuilder and standardized response creation

from functools import wraps
import traceback

class ResponseBuilder:
    """Standardized response creation"""
    
    @staticmethod
    def success_response(message_type, data):
        """Create a successful response"""
        return {'type': message_type, 'status': 'SUCCESS', **data}
    
    @staticmethod
    def error_response(message_type, error_msg, error_code=None):
        """Create an error response"""
        response = {'type': message_type, 'status': 'ERROR', 'error': error_msg}
        if error_code:
            response['error_code'] = error_code
        return response
    
    @staticmethod
    def progress_response(message_type, progress_percent, message=None):
        """Create a progress response"""
        response = {'type': message_type, 'status': 'PROGRESS', 'progress': progress_percent}
        if message:
            response['message'] = message
        return response

def handle_errors_enhanced(response_type, operation_name):
    """Decorator for consistent error handling across all processors"""
    def decorator(func):
        @wraps(func)
        def wrapper(self, data, comm):
            try:
                return func(self, data, comm)
            except Exception as e:
                self.logger.log_error_detailed(operation_name, e, data)
                user_message = self.logger.get_user_friendly_message(e) + "".join(traceback.TracebackException.from_exception(e).format())
                error_response = ResponseBuilder.error_response(response_type, user_message)
                comm.send(error_response)
        return wrapper
    return decorator

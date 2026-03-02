"""
ASGI config for mywhatsapp project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/
"""

# mywhatsapp/mywhatsapp/asgi.py
import os
from django.core.asgi import get_asgi_application

# 1. Initialize Django FIRST
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mywhatsapp.settings')
django_asgi_app = get_asgi_application()

# 2. Import your chat routing and Channels AFTER Django is initialized
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
import chat.routing
import videocalls.routing

# 3. Build the application
application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack(
        URLRouter(
            chat.routing.websocket_urlpatterns +
            videocalls.routing.websocket_urlpatterns
        )
    ),
})
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # This matches the URL your JavaScript is trying to connect to!
    re_path(r'ws/videocall/$', consumers.VideoCallConsumer.as_asgi()),
]
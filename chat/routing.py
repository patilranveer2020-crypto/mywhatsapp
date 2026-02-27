# mywhatsapp/chat/routing.py
from django.urls import re_path
from . import consumers
from videocalls.consumers import VideoCallConsumer

websocket_urlpatterns = [
    # The ID here is the OTHER person's ID (the recipient)
    re_path(r'ws/chat/(?P<id>\d+)/$', consumers.ChatConsumer.as_asgi()),
    re_path(r'ws/group/(?P<group_id>\d+)/$', consumers.GroupChatConsumer.as_asgi()),
    re_path(r'ws/videocall/', VideoCallConsumer.as_asgi()),
]
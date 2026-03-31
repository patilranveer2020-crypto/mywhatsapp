# mywhatsapp/chat/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # The ID here is the OTHER person's ID (the recipient)
    re_path(r'ws/chat/(?P<id>\d+)/$', consumers.ChatConsumer.as_asgi()),
    re_path(r'ws/group/(?P<group_id>\d+)/$', consumers.GroupChatConsumer.as_asgi()),
    
    # 👉 FIX: Tell Django to look in chat/consumers.py AND to catch the room_id (which has letters and hyphens!)
    re_path(r'ws/videocall/(?P<room_id>[\w-]+)/$', consumers.VideoCallConsumer.as_asgi()),
    re_path(r'ws/videocall/$', consumers.VideoCallConsumer.as_asgi()),
    re_path(r'ws/notifications/$', consumers.NotificationConsumer.as_asgi()),
]
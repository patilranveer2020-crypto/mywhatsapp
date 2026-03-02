import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from .models import CallInvite, VideoCall
from django.utils import timezone
from datetime import timedelta

class VideoCallConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        
        if self.user.is_authenticated:
            self.room_id = self.scope['url_route']['kwargs'].get('room_id')
            self.room_group_name = f'video_call_room_{self.room_id}'
            self.personal_group_name = f'video_call_{self.user.id}'
            
            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            await self.channel_layer.group_add(self.personal_group_name, self.channel_name)
            await self.accept()
        else:
            await self.close()

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
            await self.channel_layer.group_discard(self.personal_group_name, self.channel_name)

    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message_type = text_data_json.get('type')

        if message_type == 'call_invite':
            await self.handle_call_invite(text_data_json)
        elif message_type == 'call_response':
            await self.handle_call_response(text_data_json)
        elif message_type == 'peer_ready': # 👉 NEW!
            await self.handle_peer_ready(text_data_json)
        elif message_type == 'webrtc_ice_candidate': 
            await self.handle_ice_candidate(text_data_json)
        elif message_type == 'webrtc_offer': 
            await self.handle_offer(text_data_json)
        elif message_type == 'webrtc_answer': 
            await self.handle_answer(text_data_json)
        elif message_type == 'call_end':
            await self.handle_call_end(text_data_json)

    # =======================================================
    # DB LOGGING HANDLERS
    # =======================================================
    async def handle_call_invite(self, data):
        to_user_id = data['to_user_id']
        room_id = data['room_id']
        to_user = await database_sync_to_async(User.objects.get)(id=to_user_id)
        
        invite = await database_sync_to_async(CallInvite.objects.create)(
            from_user=self.user,
            to_user=to_user,
            room_id=room_id,
            expires_at=timezone.now() + timedelta(minutes=5)
        )
        
        await self.channel_layer.group_send(
            f'video_call_{to_user_id}',
            {
                'type': 'incoming_call',
                'from_user_id': self.user.id,
                'from_username': self.user.username,
                'room_id': room_id,
                'timestamp': timezone.now().isoformat()
            }
        )

    async def handle_call_response(self, data):
        room_id = data['room_id']
        accept = data['accept']
        
        try:
            invite = await database_sync_to_async(CallInvite.objects.get)(room_id=room_id)
            invite.accepted = accept
            await database_sync_to_async(invite.save)()
            
            if accept:
                await self.channel_layer.group_send(
                    f'video_call_{invite.from_user.id}',
                    {
                        'type': 'call_accepted',
                        'room_id': room_id,
                        'callee_id': invite.to_user.id,
                        'callee_username': invite.to_user.username
                    }
                )
                await database_sync_to_async(VideoCall.objects.create)(
                    call_type='incoming',
                    caller=invite.from_user,
                    callee=invite.to_user,
                    status='accepted',
                    room_id=room_id
                )
            else:
                await self.channel_layer.group_send(
                    f'video_call_{invite.from_user.id}',
                    {
                        'type': 'call_rejected',
                        'room_id': room_id,
                        'callee_id': invite.to_user.id,
                        'callee_username': invite.to_user.username
                    }
                )
                invite.rejected = True
                await database_sync_to_async(invite.save)()
        except CallInvite.DoesNotExist:
            pass

    async def handle_call_end(self, data):
        room_id = self.room_id
        
        try:
            video_call = await database_sync_to_async(VideoCall.objects.get)(room_id=room_id)
            if video_call:
                video_call.duration = timezone.now() - video_call.timestamp
                video_call.ended_at = timezone.now()
                video_call.status = 'ended'
                await database_sync_to_async(video_call.save)()
        except VideoCall.DoesNotExist:
            pass

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'call_ended',
                'room_id': room_id,
                'sender_channel_name': self.channel_name
            }
        )

    # =======================================================
    # WEBRTC SIGNALING HANDLERS
    # =======================================================
    async def handle_peer_ready(self, data):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'peer_ready',
                'sender_channel_name': self.channel_name
            }
        )

    async def handle_offer(self, data):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'webrtc_offer',
                'offer': data['offer'],
                'sender_channel_name': self.channel_name 
            }
        )

    async def handle_answer(self, data):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'webrtc_answer',
                'answer': data['answer'],
                'sender_channel_name': self.channel_name
            }
        )

    async def handle_ice_candidate(self, data):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'webrtc_ice_candidate',
                'candidate': data['candidate'],
                'sender_channel_name': self.channel_name
            }
        )

    # =======================================================
    # ROOM BROADCAST DISPATCHERS
    # =======================================================
    async def peer_ready(self, event):
        if self.channel_name != event.get('sender_channel_name'):
            await self.send(text_data=json.dumps({'type': 'peer_ready'}))

    async def webrtc_offer(self, event):
        if self.channel_name != event.get('sender_channel_name'):
            await self.send(text_data=json.dumps({
                'type': 'webrtc_offer',
                'offer': event['offer']
            }))

    async def webrtc_answer(self, event):
        if self.channel_name != event.get('sender_channel_name'):
            await self.send(text_data=json.dumps({
                'type': 'webrtc_answer',
                'answer': event['answer']
            }))

    async def webrtc_ice_candidate(self, event):
        if self.channel_name != event.get('sender_channel_name'):
            await self.send(text_data=json.dumps({
                'type': 'webrtc_ice_candidate',
                'candidate': event['candidate']
            }))

    async def call_ended(self, event):
        if self.channel_name != event.get('sender_channel_name'):
            await self.send(text_data=json.dumps({'type': 'call_end'}))
            
    async def incoming_call(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_accepted(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_rejected(self, event):
        await self.send(text_data=json.dumps(event))
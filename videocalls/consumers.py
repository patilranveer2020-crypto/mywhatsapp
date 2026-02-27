import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from .models import CallInvite, VideoCall
from django.utils import timezone
from datetime import timedelta
from django.db import models


class VideoCallConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        if self.user.is_authenticated:
            self.call_group_name = f'video_call_{self.user.id}'
            await self.channel_layer.group_add(
                self.call_group_name,
                self.channel_name
            )
            await self.accept()
        else:
            await self.close()

    async def disconnect(self, close_code):
        if hasattr(self, 'call_group_name'):
            await self.channel_layer.group_discard(
                self.call_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message_type = text_data_json.get('type')

        if message_type == 'call_invite':
            await self.handle_call_invite(text_data_json)
        elif message_type == 'call_response':
            await self.handle_call_response(text_data_json)
        elif message_type == 'ice_candidate':
            await self.handle_ice_candidate(text_data_json)
        elif message_type == 'offer':
            await self.handle_offer(text_data_json)
        elif message_type == 'answer':
            await self.handle_answer(text_data_json)
        elif message_type == 'call_end':
            await self.handle_call_end(text_data_json)

    async def handle_call_invite(self, data):
        to_user_id = data['to_user_id']
        room_id = data['room_id']
        to_user = await database_sync_to_async(User.objects.get)(id=to_user_id)
        
        # Create call invite
        invite = await database_sync_to_async(CallInvite.objects.create)(
            from_user=self.user,
            to_user=to_user,
            room_id=room_id,
            expires_at=timezone.now() + timedelta(minutes=5)
        )
        
        # Notify the recipient
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
                # Notify the caller that the call was accepted
                await self.channel_layer.group_send(
                    f'video_call_{invite.from_user.id}',
                    {
                        'type': 'call_accepted',
                        'room_id': room_id,
                        'callee_id': invite.to_user.id,
                        'callee_username': invite.to_user.username
                    }
                )
                
                # Create video call record
                await database_sync_to_async(VideoCall.objects.create)(
                    call_type='incoming',
                    caller=invite.from_user,
                    callee=invite.to_user,
                    status='accepted',
                    room_id=room_id
                )
            else:
                # Notify the caller that the call was rejected
                await self.channel_layer.group_send(
                    f'video_call_{invite.from_user.id}',
                    {
                        'type': 'call_rejected',
                        'room_id': room_id,
                        'callee_id': invite.to_user.id,
                        'callee_username': invite.to_user.username
                    }
                )
                
                # Update invite as rejected
                invite.rejected = True
                await database_sync_to_async(invite.save)()

        except CallInvite.DoesNotExist:
            pass

    async def handle_offer(self, data):
        room_id = data['room_id']
        offer = data['offer']
        target_user_id = data['target_user_id']
        
        # Forward the offer to the target user
        await self.channel_layer.group_send(
            f'video_call_{target_user_id}',
            {
                'type': 'webrtc_offer',
                'room_id': room_id,
                'offer': offer,
                'from_user_id': self.user.id,
                'from_username': self.user.username
            }
        )

    async def handle_answer(self, data):
        room_id = data['room_id']
        answer = data['answer']
        target_user_id = data['target_user_id']
        
        # Forward the answer to the target user
        await self.channel_layer.group_send(
            f'video_call_{target_user_id}',
            {
                'type': 'webrtc_answer',
                'room_id': room_id,
                'answer': answer,
                'from_user_id': self.user.id,
                'from_username': self.user.username
            }
        )

    async def handle_ice_candidate(self, data):
        room_id = data['room_id']
        candidate = data['candidate']
        target_user_id = data['target_user_id']
        
        # Forward the ICE candidate to the target user
        await self.channel_layer.group_send(
            f'video_call_{target_user_id}',
            {
                'type': 'webrtc_ice_candidate',
                'room_id': room_id,
                'candidate': candidate,
                'from_user_id': self.user.id,
                'from_username': self.user.username
            }
        )

    async def handle_call_end(self, data):
        room_id = data['room_id']
        target_user_id = data.get('target_user_id')
        
        try:
            video_call = await database_sync_to_async(
                VideoCall.objects.get
            )(room_id=room_id)
            
            if video_call:
                video_call.duration = timezone.now() - video_call.timestamp
                video_call.ended_at = timezone.now()
                video_call.status = 'ended'
                await database_sync_to_async(video_call.save)()

                # Notify the other party that the call has ended
                if target_user_id:
                    other_user_id = target_user_id
                else:
                    other_user_id = video_call.caller.id if video_call.callee == self.user else video_call.callee.id
                
                await self.channel_layer.group_send(
                    f'video_call_{other_user_id}',
                    {
                        'type': 'call_ended',
                        'room_id': room_id,
                        'from_user_id': self.user.id
                    }
                )
        except VideoCall.DoesNotExist:
            pass

    # Message handlers for sending to client
    async def incoming_call(self, event):
        await self.send(text_data=json.dumps({
            'type': 'incoming_call',
            'from_user_id': event['from_user_id'],
            'from_username': event['from_username'],
            'room_id': event['room_id'],
            'timestamp': event['timestamp']
        }))

    async def call_accepted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_accepted',
            'room_id': event['room_id'],
            'callee_id': event['callee_id'],
            'callee_username': event['callee_username']
        }))

    async def call_rejected(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_rejected',
            'room_id': event['room_id'],
            'callee_id': event['callee_id'],
            'callee_username': event['callee_username']
        }))

    async def webrtc_offer(self, event):
        await self.send(text_data=json.dumps({
            'type': 'webrtc_offer',
            'room_id': event['room_id'],
            'offer': event['offer'],
            'from_user_id': event['from_user_id'],
            'from_username': event['from_username']
        }))

    async def webrtc_answer(self, event):
        await self.send(text_data=json.dumps({
            'type': 'webrtc_answer',
            'room_id': event['room_id'],
            'answer': event['answer'],
            'from_user_id': event['from_user_id'],
            'from_username': event['from_username']
        }))

    async def webrtc_ice_candidate(self, event):
        await self.send(text_data=json.dumps({
            'type': 'webrtc_ice_candidate',
            'room_id': event['room_id'],
            'candidate': event['candidate'],
            'from_user_id': event['from_user_id'],
            'from_username': event['from_username']
        }))

    async def call_ended(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_ended',
            'room_id': event['room_id'],
            'from_user_id': event['from_user_id']
        }))
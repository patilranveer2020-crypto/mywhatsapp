import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Message, ChatGroup, GroupMessage, Profile
from django.contrib.auth.models import User
from django.utils import timezone
from .utils import send_push_notification

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.my_id = self.scope['user'].id
        self.other_user_id = int(self.scope['url_route']['kwargs']['id'])
        
        if self.my_id > self.other_user_id:
            self.room_name = f'chat_{self.other_user_id}_{self.my_id}'
        else:
            self.room_name = f'chat_{self.my_id}_{self.other_user_id}'

        self.room_group_name = self.room_name

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

        await self.update_user_status(self.my_id, True)
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_status',
                'user_id': self.my_id,
                'is_online': True,
                'last_seen': 'online'
            }
        )

        other_online, other_last_seen = await self.get_user_status(self.other_user_id)
        await self.send(text_data=json.dumps({
            'type': 'user_status',
            'user_id': self.other_user_id,
            'is_online': other_online,
            'last_seen': other_last_seen
        }))

    async def disconnect(self, close_code):
        last_seen_time = await self.update_user_status(self.my_id, False)
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_status',
                'user_id': self.my_id,
                'is_online': False,
                'last_seen': f"last seen today at {last_seen_time}"
            }
        )

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)

            if text_data_json.get('action') == 'delete_message':
                msg_id = text_data_json.get('message_id')
                await self.mark_message_deleted_in_db(msg_id, self.my_id)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'message_deleted',
                        'message_id': msg_id
                    }
                )
                return 

            if 'mark_read' in text_data_json:
                await self.mark_messages_read(self.other_user_id, self.my_id)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'read_receipt',
                        'reader_id': self.my_id
                    }
                )
                return

            if 'typing' in text_data_json:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'typing_status',
                        'sender_id': self.my_id,
                        'is_typing': text_data_json['typing']
                    }
                )
                return 
            
            if text_data_json.get('type') == 'video_call_init':
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'incoming_video_call',
                        'caller_id': self.my_id,
                        'caller_name': self.scope['user'].username,
                        'room_id': text_data_json['room_id']
                    }
                )
                return

            # 👉 NEW: Video Bypass Logic for Private Chats
            video_url = text_data_json.get('video_url')
            message_content = text_data_json.get('message', '')

            if video_url:
                sender_name = self.scope['user'].username
                try:
                    await self.trigger_private_push(self.other_user_id, f"New video from {sender_name}", "🎥 Video message")
                except Exception as e:
                    print(f"Push error: {e}")

                from django.utils import timezone
                local_time = timezone.localtime()

                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'chat_message',
                        'message_id': text_data_json.get('message_id', 0), 
                        'message': message_content,
                        'video_url': video_url, # Pass the URL to the group!
                        'sender_id': self.my_id,
                        'sender_name': sender_name,
                        'timestamp': local_time.strftime("%I:%M %p"),
                        'date': local_time.strftime("%Y-%m-%d"),
                        'is_read': False
                    }
                )
                return

            # --- NORMAL TEXT MESSAGE LOGIC ---
            try:
                # 1. Save the message to the database
                new_msg = await self.save_message(message_content, self.my_id, self.other_user_id)
                
                # 2. TRIGGER THE PUSH NOTIFICATION!
                sender_name = self.scope['user'].username
                await self.trigger_private_push(self.other_user_id, f"New message from {sender_name}", message_content)
                
            except Exception as db_error:
                print(f"--- DATABASE ERROR: {db_error} ---")
                await self.send(text_data=json.dumps({
                    'message': f"⚠️ DATABASE ERROR: Could not save message. Check terminal.",
                    'sender_id': self.other_user_id, 
                    'timestamp': 'Now',
                    'date': 'Today',
                    'is_read': False
                }))
                return 

            local_timestamp = timezone.localtime(new_msg.timestamp)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message_id': new_msg.id, 
                    'message': new_msg.content,
                    'sender_id': self.my_id,
                    'sender_name': self.scope['user'].username,
                    'timestamp': local_timestamp.strftime("%I:%M %p"),
                    'date': local_timestamp.strftime("%Y-%m-%d"),
                    'is_read': False
                }
            )
            
        except Exception as e:
            print(f"--- CRITICAL WEBSOCKET ERROR: {e} ---")
    
    async def incoming_video_call(self, event):
        await self.send(text_data=json.dumps({
            'type': 'incoming_video_call',
            'caller_id': event['caller_id'],
            'caller_name': event['caller_name'],
            'room_id': event['room_id']
        }))

    async def chat_message(self, event):
        # Send the message down to the browser
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message_id': event.get('message_id'),
            'message': event.get('message'),
            'video_url': event.get('video_url'), # 👉 NEW: Pass it to frontend
            'sender_id': event.get('sender_id'),
            'sender_name': event.get('sender_name'),
            'timestamp': event.get('timestamp'),
            'date': event.get('date'),
            'is_read': event.get('is_read')
        }))

    async def message_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'message_id': event['message_id']
        }))

    async def typing_status(self, event):
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'sender_id': event['sender_id'],
            'is_typing': event['is_typing']
        }))

    async def read_receipt(self, event):
        await self.send(text_data=json.dumps({
            'type': 'read_receipt',
            'reader_id': event['reader_id']
        }))

    # --- DATABASE FUNCTIONS ---
    @database_sync_to_async
    def save_message(self, message, sender_id, recipient_id):
        sender = User.objects.get(id=sender_id)
        recipient = User.objects.get(id=recipient_id)
        msg = Message.objects.create(sender=sender, recipient=recipient, content=message)
        return msg 

    @database_sync_to_async
    def trigger_private_push(self, target_user_id, title, message):
        try:
            target_user = User.objects.get(id=target_user_id)
            send_push_notification(target_user, title, message)
        except Exception as e:
            print(f"Push Notification Failed: {e}")

    @database_sync_to_async
    def mark_messages_read(self, sender_id, recipient_id):
        Message.objects.filter(sender_id=sender_id, recipient_id=recipient_id, is_read=False).update(is_read=True)

    @database_sync_to_async
    def mark_message_deleted_in_db(self, msg_id, user_id):
        try:
            msg = Message.objects.get(id=msg_id, sender_id=user_id)
            msg.content = "This message was deleted"
            msg.save()
        except Message.DoesNotExist:
            pass

    async def user_status(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_status',
            'user_id': event['user_id'],
            'is_online': event['is_online'],
            'last_seen': event['last_seen']
        }))

    @database_sync_to_async
    def update_user_status(self, user_id, is_online):
        try:
            profile = Profile.objects.get(user__id=user_id)
            profile.is_online = is_online
            profile.last_seen = timezone.now()
            profile.save()
            return timezone.localtime(profile.last_seen).strftime("%I:%M %p")
        except Profile.DoesNotExist:
            return ""

    @database_sync_to_async
    def get_user_status(self, user_id):
        try:
            profile = Profile.objects.get(user__id=user_id)
            if profile.is_online:
                return True, "online"
            else:
                last_seen_local = timezone.localtime(profile.last_seen)
                return False, f"last seen today at {last_seen_local.strftime('%I:%M %p')}"
        except Profile.DoesNotExist:
            return False, ""


class GroupChatConsumer(AsyncWebsocketConsumer):
    @database_sync_to_async
    def update_user_last_seen(self):
        user = self.scope['user']
        if user.is_authenticated:
            try:
                profile = Profile.objects.get(user=user)
                profile.last_seen = timezone.now()
                profile.save(update_fields=['last_seen'])
            except Profile.DoesNotExist:
                pass

    async def connect(self):
        self.group_id = self.scope['url_route']['kwargs']['group_id']
        self.room_group_name = f'chat_group_{self.group_id}'

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()
        
        await self.update_user_last_seen()

    async def disconnect(self, close_code):
        await self.update_user_last_seen()

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        user_id = self.scope['user'].id
        sender_name = self.scope['user'].username

        if text_data_json.get('action') == 'delete_message':
            msg_id = text_data_json.get('message_id')
            await self.mark_group_message_deleted_in_db(msg_id, user_id)
            
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'message_deleted',
                    'message_id': msg_id
                }
            )
            return 

        # 👉 NEW: Video Bypass Logic for Group Chats
        video_url = text_data_json.get('video_url')
        message = text_data_json.get('message', '')

        if video_url or message:
            
            if video_url:
                # Video Bypass! Skip database saving
                await self.trigger_group_push(self.group_id, user_id, sender_name, "🎥 Video message")
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'chat_message',
                        'message_id': text_data_json.get('message_id', 0),
                        'message': message,
                        'video_url': video_url, # Pass URL to group
                        'sender_id': user_id,
                        'sender_name': sender_name,
                        'timestamp': timezone.localtime().strftime('%H:%M')
                    }
                )
                return

            # Normal Text Message Logic
            saved_msg = await self.save_group_message(user_id, self.group_id, message)
            await self.trigger_group_push(self.group_id, user_id, sender_name, message)

            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message_id': saved_msg.id, 
                    'message': message,
                    'video_url': None,
                    'sender_id': user_id,
                    'sender_name': sender_name,
                    'timestamp': timezone.localtime(saved_msg.timestamp).strftime('%H:%M')
                }
            )
            
        elif 'type' in text_data_json and text_data_json['type'] == 'typing':
            pass 
            
        elif text_data_json.get('mark_read'):
            pass 

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message_id': event.get('message_id'), 
            'message': event.get('message'),
            'video_url': event.get('video_url'), # 👉 NEW: Pass it to frontend
            'sender_id': event.get('sender_id'),
            'sender_name': event.get('sender_name'),
            'timestamp': event.get('timestamp')
        }))

    async def message_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'message_id': event['message_id']
        }))

    @database_sync_to_async
    def save_group_message(self, user_id, group_id, message):
        user = User.objects.get(id=user_id)
        group = ChatGroup.objects.get(id=group_id)
        return GroupMessage.objects.create(sender=user, group=group, content=message)

    @database_sync_to_async
    def trigger_group_push(self, group_id, sender_id, sender_name, message):
        try:
            group = ChatGroup.objects.get(id=group_id)
            for member in group.members.exclude(id=sender_id):
                send_push_notification(member, f"Group: {group.name}", f"{sender_name}: {message}")
        except Exception as e:
            print(f"Group Push Notification Failed: {e}")

    @database_sync_to_async
    def mark_group_message_deleted_in_db(self, msg_id, user_id):
        try:
            msg = GroupMessage.objects.get(id=msg_id, sender_id=user_id)
            msg.content = "This message was deleted"
            msg.save()
        except GroupMessage.DoesNotExist:
            pass

class VideoCallConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        kwargs = self.scope['url_route']['kwargs']
        self.room_id = kwargs.get('room_id') or kwargs.get('id') or "waiting_room"
        self.room_group_name = f'video_call_{self.room_id}'

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'forward_message',
                'message': text_data,
                'sender_channel_name': self.channel_name
            }
        )

    async def forward_message(self, event):
        if self.channel_name != event['sender_channel_name']:
            await self.send(text_data=event['message'])
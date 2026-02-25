# mywhatsapp/chat/consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Message, ChatGroup, GroupMessage, Profile
from django.contrib.auth.models import User
from django.utils import timezone

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

        # --- NEW: ONLINE STATUS LOGIC ---
        # 1. Update the database to say I am online right now
        await self.update_user_status(self.my_id, True)
        
        # 2. Tell the room that I just came online
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_status',
                'user_id': self.my_id,
                'is_online': True,
                'last_seen': 'online'
            }
        )

        # 3. Immediately fetch the OTHER person's status and send it to me
        # (So I know if they are already waiting in the chat!)
        other_online, other_last_seen = await self.get_user_status(self.other_user_id)
        await self.send(text_data=json.dumps({
            'type': 'user_status',
            'user_id': self.other_user_id,
            'is_online': other_online,
            'last_seen': other_last_seen
        }))

    async def disconnect(self, close_code):
        # --- NEW: OFFLINE STATUS LOGIC ---
        # 1. Update the database to say I left, and grab the exact time
        last_seen_time = await self.update_user_status(self.my_id, False)
        
        # 2. Tell the room I left so my friend sees my "Last Seen"
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

    # --- 1. RECEIVE MESSAGE FROM FRONTEND ---
    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)

            # -----------------------------------------------------------
            # NEW: MESSAGE DELETION INTERCEPTOR
            # -----------------------------------------------------------
            if text_data_json.get('action') == 'delete_message':
                msg_id = text_data_json.get('message_id')
                
                # 1. Update the database securely
                await self.mark_message_deleted_in_db(msg_id, self.my_id)
                
                # 2. Broadcast the deletion to the room
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'message_deleted',
                        'message_id': msg_id
                    }
                )
                return # Stop here!
            # -----------------------------------------------------------

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

            # -----------------------------------------------------------
            # TYPING INDICATOR INTERCEPTOR
            # -----------------------------------------------------------
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
            # -----------------------------------------------------------

            message_content = text_data_json['message']
            print(f"--- TRYING TO PROCESS: {repr(message_content)} ---")

            try:
                new_msg = await self.save_message(message_content, self.my_id, self.other_user_id)
                print("--- SAVED TO DATABASE SUCCESSFULLY ---")
                
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

            # Broadcast the message normally (ADDED message_id here!)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message_id': new_msg.id, # <-- NEW
                    'message': new_msg.content,
                    'sender_id': self.my_id,
                    'timestamp': new_msg.timestamp.strftime("%I:%M %p"),
                    'date': new_msg.timestamp.strftime("%Y-%m-%d"),
                    'is_read': False
                }
            )
            
        except Exception as e:
            print(f"--- CRITICAL WEBSOCKET ERROR: {e} ---")
   
    
    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'message_id': event['message_id'], # <-- NEW
            'message': event['message'],
            'sender_id': event['sender_id'],
            'timestamp': event['timestamp'],
            'date': event['date'],
            'is_read': event['is_read']
        }))

    # --- NEW: BROADCAST MESSAGE DELETED ---
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
    def mark_messages_read(self, sender_id, recipient_id):
        Message.objects.filter(sender_id=sender_id, recipient_id=recipient_id, is_read=False).update(is_read=True)

    # NEW: Securely update the message text in the DB
    @database_sync_to_async
    def mark_message_deleted_in_db(self, msg_id, user_id):
        try:
            # Only allow the sender to delete their own message!
            msg = Message.objects.get(id=msg_id, sender_id=user_id)
            msg.content = "This message was deleted"
            msg.save()
        except Message.DoesNotExist:
            pass


    # --- NEW: STATUS BROADCAST HANDLER ---
    async def user_status(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_status',
            'user_id': event['user_id'],
            'is_online': event['is_online'],
            'last_seen': event['last_seen']
        }))

    # --- NEW: DATABASE SYNC FUNCTIONS FOR STATUS ---
    @database_sync_to_async
    def update_user_status(self, user_id, is_online):
        try:
            profile = Profile.objects.get(user__id=user_id)
            profile.is_online = is_online
            profile.last_seen = timezone.now()
            profile.save()
            return profile.last_seen.strftime("%I:%M %p")
        except Profile.DoesNotExist:
            return ""

    @database_sync_to_async
    def get_user_status(self, user_id):
        try:
            profile = Profile.objects.get(user__id=user_id)
            if profile.is_online:
                return True, "online"
            else:
                return False, f"last seen today at {profile.last_seen.strftime('%I:%M %p')}"
        except Profile.DoesNotExist:
            return False, ""


class GroupChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.group_id = self.scope['url_route']['kwargs']['group_id']
        self.room_group_name = f'chat_group_{self.group_id}'

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
        text_data_json = json.loads(text_data)
        user_id = self.scope['user'].id

        # -----------------------------------------------------------
        # GROUP MESSAGE DELETION INTERCEPTOR
        # -----------------------------------------------------------
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
        # -----------------------------------------------------------

        # 1. SAFELY CHECK IF THIS IS AN ACTUAL TEXT MESSAGE
        if 'message' in text_data_json:
            message = text_data_json['message']
            saved_msg = await self.save_group_message(user_id, self.group_id, message)

            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message_id': saved_msg.id, 
                    'message': message,
                    'sender_id': user_id,
                    'sender_name': self.scope['user'].username,
                    'timestamp': saved_msg.timestamp.strftime('%H:%M')
                }
            )
            
        # 2. IGNORE BACKGROUND SIGNALS (so they don't crash the server!)
        elif 'type' in text_data_json and text_data_json['type'] == 'typing':
            pass # Group typing logic can go here later
            
        elif text_data_json.get('mark_read'):
            pass # Group read receipt logic can go here later

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'message_id': event['message_id'], # <-- NEW
            'message': event['message'],
            'sender_id': event['sender_id'],
            'sender_name': event['sender_name'],
            'timestamp': event['timestamp']
        }))

    # --- NEW: BROADCAST GROUP MESSAGE DELETED ---
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

    # NEW: Securely update the group message text in the DB
    @database_sync_to_async
    def mark_group_message_deleted_in_db(self, msg_id, user_id):
        try:
            msg = GroupMessage.objects.get(id=msg_id, sender_id=user_id)
            msg.content = "This message was deleted"
            msg.save()
        except GroupMessage.DoesNotExist:
            pass
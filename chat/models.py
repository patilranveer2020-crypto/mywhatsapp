from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

class Message(models.Model):
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='received_messages') # Add this
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)
    image = models.ImageField(upload_to='chat_images/', blank=True, null=True)

    def __str__(self):
        return f"From {self.sender} to {self.recipient}"
    

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    image = models.ImageField(upload_to='profile_pics', default='default.jpg')
    status = models.CharField(max_length=100, default="I'm using WhatsApp")
    is_online = models.BooleanField(default=False)
    last_seen = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f'{self.user.username} Profile'




class ChatGroup(models.Model):
    name = models.CharField(max_length=100)
    # A group can have many users, and a user can be in many groups
    members = models.ManyToManyField(User, related_name='chat_groups')
    admin = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='admin_groups')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

class GroupMessage(models.Model):
    group = models.ForeignKey(ChatGroup, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE)
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    # We will use this to track who has seen the message later
    read_by = models.ManyToManyField(User, related_name='read_group_messages', blank=True)

    def __str__(self):
        return f"{self.sender.username} in {self.group.name}: {self.content[:20]}"
    




class UserStatus(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='statuses')
    image = models.ImageField(upload_to='statuses/', blank=True, null=True)
    caption = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username}'s status at {self.created_at.strftime('%H:%M')}"
    
    @property
    def is_active(self):
        # This is the magic 24-hour rule!
        from django.utils import timezone
        from datetime import timedelta
        return timezone.now() <= self.created_at + timedelta(hours=24)
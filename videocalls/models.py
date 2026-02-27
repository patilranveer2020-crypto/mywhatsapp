from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

class VideoCall(models.Model):
    """Model to track video call sessions"""
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('rejected', 'Rejected'),
        ('ended', 'Ended'),
    )
    
    caller = models.ForeignKey(User, on_delete=models.CASCADE, related_name='outgoing_calls')
    callee = models.ForeignKey(User, on_delete=models.CASCADE, related_name='incoming_calls')
    room_id = models.CharField(max_length=100, unique=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    timestamp = models.DateTimeField(default=timezone.now)
    duration = models.DurationField(null=True, blank=True)
    call_type = models.CharField(max_length=10, default='incoming')
    ended_at = models.DateTimeField(null=True, blank=True)
    
    def __str__(self):
        return f"{self.caller.username} -> {self.callee.username} ({self.status})"
    
    class Meta:
        ordering = ['-timestamp']

class CallInvite(models.Model):
    from_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_invites')
    to_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='received_invites')
    room_id = models.CharField(max_length=100, unique=True)
    accepted = models.BooleanField(default=False)
    rejected = models.BooleanField(default=False)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"Invite from {self.from_user.username} to {self.to_user.username}"
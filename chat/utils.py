import json
from pywebpush import webpush, WebPushException
from django.conf import settings
from .models import PushSubscription 

def send_push_notification(user, title, message, extra_data=None):
    print(f"🚨 DOORBELL TRIGGERED: Trying to wake up {user.username}'s phone!")
    
    try:
        # Try to find the phone in the database
        subscription = PushSubscription.objects.get(user=user)
        print("🚨 SUCCESS: Found their phone in the database! Sending signal...")
        
        push_data = {
            "title": title,
            "body": message
        }
        
        if extra_data:
            push_data.update(extra_data)
        
        sub_info = {
            "endpoint": subscription.endpoint,
            "keys": {
                "p256dh": subscription.p256dh,
                "auth": subscription.auth
            }
        }
        
        webpush(
            subscription_info=sub_info,
            data=json.dumps(push_data),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={
                "sub": settings.VAPID_ADMIN_EMAIL
            }
        )
        print("🚨 SUCCESS: Signal sent to Google/Apple successfully!")
        
    except PushSubscription.DoesNotExist:
        # THE ALARM: This tells us if the phone never registered!
        print(f"🚨 ERROR: Could not find {user.username}'s phone in the database. They need to 'Allow Notifications' on their device!")
        
    except Exception as ex:
        print(f"🚨 CRITICAL ERROR: The push failed. Reason: {repr(ex)}")

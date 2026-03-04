import json
from pywebpush import webpush, WebPushException
from django.conf import settings
from .models import PushSubscription # Adjust import if needed

def send_push_notification(user, title, message, extra_data=None):
    try:
        # Find the device token for the user receiving the message
        subscription = PushSubscription.objects.get(user=user)
        
        # Package the message
        push_data = {
            "title": title,
            "body": message
        }
        
        # 👉 NEW: If we pass extra instructions (like video call info), attach them!
        if extra_data:
            push_data.update(extra_data)
        
        # Format the token exactly how Google/Apple expects it
        sub_info = {
            "endpoint": subscription.endpoint,
            "keys": {
                "p256dh": subscription.p256dh,
                "auth": subscription.auth
            }
        }
        
        # Fire the notification into the cloud!
        webpush(
            subscription_info=sub_info,
            data=json.dumps(push_data),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={
                "sub": settings.VAPID_ADMIN_EMAIL
            }
        )
    except PushSubscription.DoesNotExist:
        # The user hasn't allowed notifications on their phone yet
        pass
    except WebPushException as ex:
        print("Push failed:", repr(ex))
        # If the token is expired, delete it so we don't keep trying
        if ex.response and ex.response.status_code in [404, 410]:
            subscription.delete()
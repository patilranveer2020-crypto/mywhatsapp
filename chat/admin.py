from django.contrib import admin
from .models import Profile
from .models import ChatGroup, GroupMessage , UserStatus, Message, PushSubscription

admin.site.register(ChatGroup)
admin.site.register(GroupMessage)

admin.site.register(Profile)
admin.site.register(UserStatus)
admin.site.register(PushSubscription)
# Register your models here.

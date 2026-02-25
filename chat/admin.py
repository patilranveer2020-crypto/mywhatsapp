from django.contrib import admin
from .models import Profile
from .models import ChatGroup, GroupMessage , UserStatus

admin.site.register(ChatGroup)
admin.site.register(GroupMessage)

admin.site.register(Profile)
admin.site.register(UserStatus)
# Register your models here.

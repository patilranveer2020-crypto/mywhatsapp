from django.urls import path
from . import views

app_name = 'videocalls'

urlpatterns = [
    path('initiate/', views.initiate_video_call, name='initiate_video_call'),
    path('active/', views.get_active_calls, name='get_active_calls'),
    path('history/', views.get_call_history, name='get_call_history'),
    path('<str:room_id>/', views.video_call, name='video_call'),
]

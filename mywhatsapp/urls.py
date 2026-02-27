"""
URL configuration for mywhatsapp project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.contrib.auth import views as auth_views
from chat import views  # <--- THIS IS THE MAGIC FIX (importing from chat)
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    # Service Worker (must be at root for full scope)
    path('sw.js', views.service_worker, name='service_worker'),
    
    # Admin Panel
    path('admin/', admin.site.urls),
    
    # Main Chat Page
    path('', views.index, name='index'),
    
    # Authentication (Login & Signup)
    path('signup/', views.signup, name='signup'),
    path('login/', auth_views.LoginView.as_view(template_name='chat/login.html'), name='login'),
    path('accounts/', include('django.contrib.auth.urls')),
    
    # Your Custom APIs & Settings
    path('settings/', views.settings_page, name='settings'),
    path('api/messages/<int:user_id>/', views.get_messages, name='get_messages'),
    path('api/upload/', views.upload_image, name='upload_image'),
    path('api/create-group/', views.create_group, name='create_group'),
    path('api/group/<int:group_id>/messages/', views.get_group_messages, name='group_messages'),
    
    # Status Updates
    path('api/status/upload/', views.upload_status, name='upload_status'),
    path('api/status/list/', views.get_statuses, name='get_statuses'),
    path('api/status/delete/<int:status_id>/', views.delete_status, name='delete_status'),

    path('api/save-subscription/', views.save_subscription, name='save_subscription'),
    path('api/test-push/', views.test_push, name='test_push'),
]

# Keep your media settings for images
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
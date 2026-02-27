from datetime import datetime, timedelta
from django.shortcuts import render, redirect
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse
from django.core.files.storage import default_storage
from .models import Message, Profile, ChatGroup, GroupMessage, UserStatus, PushSubscription
from .forms import ProfileUpdateForm
from django.utils import timezone
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth import login
from django.views.decorators.http import require_POST
import json

@login_required
def index(request):
    users = User.objects.exclude(id=request.user.id)
    chat_list = []

    my_groups = ChatGroup.objects.filter(members=request.user).order_by('-created_at')

    for user in users:
        # Count how many unread messages this specific user sent to me
        user.unread_count = Message.objects.filter(
            sender=user, 
            recipient=request.user, 
            is_read=False
        ).count()

    context = {
        'users': users,
        'groups': my_groups,
    }

    for user in users:
        # FIX: Changed 'receiver' to 'recipient'
        last_msg = Message.objects.filter(
            (Q(sender=request.user, recipient=user) | 
             Q(sender=user, recipient=request.user))
        ).order_by('-timestamp').first()

        user.last_msg = last_msg.content if last_msg else None
        user.last_time = last_msg.timestamp if last_msg else None
        chat_list.append(user)

    
    chat_list.sort(key=lambda x: x.last_time if x.last_time else datetime.min.replace(tzinfo=timezone.UTC), reverse=True)
    print("--- DEBUG GROUPS --- :", my_groups)
    return render(request, 'chat/wp.html', {
        'users': chat_list, 
        'groups': my_groups
    })

@login_required
def get_messages(request, user_id):
    active_user_id = user_id
    
    # 1. Mark unread messages from this user as READ (since we just opened the chat)
    Message.objects.filter(sender_id=active_user_id, recipient=request.user, is_read=False).update(is_read=True)

    # 2. Get the messages
    messages = Message.objects.filter(
        (Q(sender=request.user, recipient_id=active_user_id) | 
         Q(sender_id=active_user_id, recipient=request.user))
    ).order_by('timestamp')
    
    results = []
    for msg in messages:
        results.append({
            'id': msg.id,
            'content': msg.content,
            'sender_id': msg.sender.id,
            'timestamp': msg.timestamp.strftime("%I:%M %p"),
            'date': msg.timestamp.strftime("%Y-%m-%d"),
            # --- SEND THE STATUS ---
            'is_read': msg.is_read 
        })
    
    return JsonResponse(results, safe=False)


@login_required
def settings_page(request):
    profile, created = Profile.objects.get_or_create(user=request.user)
    
    if request.method == 'POST':
        form = ProfileUpdateForm(request.POST, request.FILES, instance=profile)
        if form.is_valid():
            form.save()
            return redirect('index')
    else:
        form = ProfileUpdateForm(instance=profile)

    return render(request, 'chat/settings.html', {'form': form})




@login_required
def upload_image(request):
    if request.method == 'POST' and request.FILES.get('image'):
        uploaded_file = request.FILES['image']
        
        # 1. This is the magic line! default_storage automatically sends it to Cloudinary
        file_name = default_storage.save(uploaded_file.name, uploaded_file)
        
        # 2. This grabs the secure https://res.cloudinary.com/... link
        file_url = default_storage.url(file_name)
        
        # 3. Print it to the terminal so we can prove it worked!
        print(f"SUCCESS: Uploaded to Cloudinary at {file_url}")
        
        return JsonResponse({
            'status': 'success', 
            'image_url': file_url
        })
        
    return JsonResponse({'status': 'error', 'message': 'No image provided'})


@login_required
def create_group(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            group_name = data.get('name')
            member_ids = data.get('members', [])

            if not group_name:
                return JsonResponse({'status': 'error', 'message': 'Group name is required.'})
            if not member_ids:
                return JsonResponse({'status': 'error', 'message': 'Please select at least one member.'})

            # 1. Create the Group and set you as the admin
            new_group = ChatGroup.objects.create(name=group_name, admin=request.user)

            # 2. Add you (the creator) to the members list automatically
            new_group.members.add(request.user)

            # 3. Add all the selected friends
            for user_id in member_ids:
                try:
                    user = User.objects.get(id=user_id)
                    new_group.members.add(user)
                except User.DoesNotExist:
                    continue 

            return JsonResponse({'status': 'success', 'group_id': new_group.id})
            
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
            
    return JsonResponse({'status': 'error', 'message': 'Invalid request'})




@login_required
def get_group_messages(request, group_id):
    try:
        group = ChatGroup.objects.get(id=group_id)
        
        # Security check: Make sure the user is actually in this group
        if request.user not in group.members.all():
            return JsonResponse({'status': 'error', 'message': 'Not a member of this group.'})

        # Fetch messages in order of oldest to newest
        messages = GroupMessage.objects.filter(group=group).order_by('timestamp')
        
        msg_list = []
        for msg in messages:
            msg_list.append({
                'id': msg.id,
                'sender_id': msg.sender.id,
                'sender_name': msg.sender.username,
                'content': msg.content,
                'timestamp': msg.timestamp.strftime('%H:%M')
            })
            
        return JsonResponse({'status': 'success', 'messages': msg_list})
        
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})
    



@login_required
def upload_status(request):
    if request.method == 'POST':
        image = request.FILES.get('status_image')
        caption = request.POST.get('caption', '')
        
        if image:
            status = UserStatus.objects.create(
                user=request.user,
                image=image,
                caption=caption
            )
            return JsonResponse({'status': 'success', 'message': 'Status uploaded!'})
        return JsonResponse({'status': 'error', 'message': 'No image provided.'})
    return JsonResponse({'status': 'error', 'message': 'Invalid request.'})


@login_required
def get_statuses(request):
    # 1. Calculate the exact time 24 hours ago
    cutoff_time = timezone.now() - timedelta(hours=24)
    
    # 2. Fetch ONLY statuses from the last 24 hours (Old ones are ignored!)
    recent_statuses = UserStatus.objects.filter(created_at__gte=cutoff_time).order_by('-created_at')
    
    # 3. Group them by user so the UI can show one circle per person
    status_dict = {}
    for status in recent_statuses:
        user_id = status.user.id
        if user_id not in status_dict:
            status_dict[user_id] = {
                'username': status.user.username,
                'is_me': status.user == request.user, # Helps us put "My Status" at the top later
                'avatar': f"https://ui-avatars.com/api/?name={status.user.username}&background=random",
                'statuses': []
            }
        
        # Add the specific status image to this user's list
        status_dict[user_id]['statuses'].append({
            'id': status.id,
            'image_url': status.image.url if status.image else '',
            'caption': status.caption,
            'time': status.created_at.strftime('%H:%M')
        })
        
    # Convert our grouped dictionary into a list and send it to the browser
    return JsonResponse({'status': 'success', 'data': list(status_dict.values())})



@login_required
def delete_status(request, status_id):
    if request.method == 'POST':
        try:
            # Security check: Get the status ONLY if it belongs to the logged-in user
            status = UserStatus.objects.get(id=status_id, user=request.user)
            status.delete()
            return JsonResponse({'status': 'success', 'message': 'Status deleted.'})
        except UserStatus.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Status not found or unauthorized.'})
            
    return JsonResponse({'status': 'error', 'message': 'Invalid request.'})



def signup(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            # Automatically log the user in after they sign up!
            login(request, user)
            # Redirect them to your main chat page (change 'index' if your main view is named differently)
            return redirect('index') 
    else:
        form = UserCreationForm()

    return render(request, 'chat/signup.html', {'form': form})



@login_required
@require_POST
def save_subscription(request):
    # Parse the token data sent from JavaScript
    sub_data = json.loads(request.body)
    
    # Save or update the device token for the logged-in user
    PushSubscription.objects.update_or_create(
        user=request.user,
        defaults={
            'endpoint': sub_data['endpoint'],
            'p256dh': sub_data['keys']['p256dh'],
            'auth': sub_data['keys']['auth'],
        }
    )
    return JsonResponse({'status': 'success'})
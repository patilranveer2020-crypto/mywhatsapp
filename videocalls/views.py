from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.db.models import Q
from .models import VideoCall
from django.contrib.auth.models import User
from django.utils import timezone
import json
import uuid

import json

@login_required
def video_call(request, room_id):
    """Video call view"""
    video_call = get_object_or_404(VideoCall, room_id=room_id)
    target_user = video_call.caller if video_call.callee == request.user else video_call.callee
    is_caller = json.dumps(video_call.caller == request.user)
    context = {
        'room_id': room_id,
        'target_user': target_user,
        'is_caller': is_caller
    }
    return render(request, 'videocalls/videocall.html', context)


@login_required
def initiate_video_call(request):
    """Initiate a video call to a specific user"""
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            to_user_id = data.get('to_user_id')
            
            to_user = get_object_or_404(User, id=to_user_id)
            
            # Create a unique room ID for the call
            room_id = str(uuid.uuid4())
            
            # Create a video call record
            video_call = VideoCall.objects.create(
                caller=request.user,
                callee=to_user,
                room_id=room_id,
            )
            
            return JsonResponse({
                'status': 'success',
                'call_id': video_call.id,
                'room_id': room_id,
            })
        except Exception as e:
            return JsonResponse({
                'status': 'error',
                'message': str(e)
            })
    
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@login_required
def get_active_calls(request):
    """Get active video calls for the user"""
    active_calls = VideoCall.objects.filter(
        (Q(caller=request.user) | Q(callee=request.user)),
        status='accepted'
    ).select_related('caller', 'callee')
    
    calls_data = []
    for call in active_calls:
        calls_data.append({
            'id': call.id,
            'caller': {
                'id': call.caller.id,
                'username': call.caller.username
            },
            'callee': {
                'id': call.callee.id,
                'username': call.callee.username
            },
            'room_id': call.room_id,
            'timestamp': call.timestamp.isoformat(),
            'status': call.status
        })
    
    return JsonResponse({'status': 'success', 'calls': calls_data})


@login_required
def get_call_history(request):
    """Get call history for the user"""
    call_history = VideoCall.objects.filter(
        (Q(caller=request.user) | Q(callee=request.user)),
        status__in=['ended', 'rejected']
    ).select_related('caller', 'callee').order_by('-timestamp')[:50]
    
    history_data = []
    for call in call_history:
        history_data.append({
            'id': call.id,
            'caller': {
                'id': call.caller.id,
                'username': call.caller.username
            },
            'callee': {
                'id': call.callee.id,
                'username': call.callee.username
            },
            'status': call.status,
            'timestamp': call.timestamp.isoformat(),
            'duration': str(call.duration) if call.duration else None,
        })
    
    return JsonResponse({'status': 'success', 'history': history_data})
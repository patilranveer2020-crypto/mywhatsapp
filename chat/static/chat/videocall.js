document.addEventListener('DOMContentLoaded', function() {
    const videoCallButton = document.getElementById('video-call-btn');
    const activeUserId = document.getElementById('current-user-id').value;
    let signalingSocket;

    function setupWebSocket() {
        signalingSocket = new WebSocket(`wss://${window.location.host}/ws/videocall/`);

        signalingSocket.onopen = () => {
            console.log('Video call signaling socket connected.');
        };

        signalingSocket.onmessage = (e) => {
            const data = JSON.parse(e.data);
            console.log('Signaling message received:', data);

            switch (data.type) {
                case 'incoming_call':
                    handleIncomingCall(data);
                    break;
                case 'call_rejected':
                    handleCallRejected(data);
                    break;
            }
        };

        signalingSocket.onclose = () => {
            console.log('Video call signaling socket closed.');
        };

        signalingSocket.onerror = (err) => {
            console.error('Video call signaling socket error:', err);
        };
    }

    function handleIncomingCall(data) {
        const { from_username, room_id } = data;
        const notification = document.createElement('div');
        notification.className = 'top-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notif-sender">${from_username} is calling you.</span>
                <button id="join-call-btn" class="mark-read-btn">Join Call</button>
            </div>
        `;
        document.body.appendChild(notification);
        notification.style.display = 'flex';

        document.getElementById('join-call-btn').onclick = () => {
            window.open(`/videocalls/${room_id}/`, '_blank');
            notification.remove();
        };
    }
    
    function handleCallRejected(data) {
        alert(`${data.callee_username} rejected your call.`);
    }

    videoCallButton.addEventListener('click', () => {
        const toUserId = getActiveChatUserId();
        if (toUserId) {
            fetch('/videocalls/initiate/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({
                    to_user_id: toUserId
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    window.open(`/videocalls/${data.room_id}/`, '_blank');
                    // Also send a WebSocket message to notify the other user
                    signalingSocket.send(JSON.stringify({
                        'type': 'call_invite',
                        'to_user_id': toUserId,
                        'room_id': data.room_id
                    }));
                } else {
                    alert('Error initiating call: ' + data.message);
                }
            });
        }
    });

    function getActiveChatUserId() {
        const activeChatItem = document.querySelector('.chat-item.active');
        if (activeChatItem) {
            return activeChatItem.dataset.userId;
        }
        return null;
    }
    
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }


    setupWebSocket();
});

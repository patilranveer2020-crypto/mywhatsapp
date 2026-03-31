let chatSocket = null;
let activeUserId = null;
let lastSeenDate = null;

// ==========================================
// NOTIFICATION SOUND & POPUP SYSTEM
// ==========================================
const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
let notificationPermission = false;

// Request notification permission on load
if ("Notification" in window) {
    Notification.requestPermission().then(permission => {
        notificationPermission = permission === "granted";
    });
}

// Play notification sound
window.playNotificationSound = function() {
    notificationSound.currentTime = 0;
    notificationSound.play().catch(e => console.log('Sound play failed:', e));
};

// Show browser notification (works when minimized/closed)
window.showBrowserNotification = function(senderName, messageText, senderId) {
    // Always show in-app banner
    window.showPersistentNotification(senderName, messageText);
    
    // Play sound
    window.playNotificationSound();
    
    // Show system notification if permitted and tab is hidden
    if (notificationPermission && document.hidden) {
        const notification = new Notification(senderName || "New Message", {
            body: messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText,
            icon: '/static/icon-192.png',
            badge: '/static/icon-192.png',
            tag: 'whatsapp-message-' + senderId,
            requireInteraction: false,
            silent: false
        });
        
        notification.onclick = function() {
            window.focus();
            if (senderId) {
                startChat(senderId, senderName);
            }
            this.close();
        };
    }
};

// Dismiss the notification banner
window.dismissNotification = function() {
    const topNotification = document.getElementById('top-notification');
    if (topNotification) {
        topNotification.classList.add('hiding');
        setTimeout(() => {
            topNotification.style.display = 'none';
            topNotification.classList.remove('hiding');
        }, 300);
    }
};

// ==========================================
// 0. NOTIFICATION LOGIC
// ==========================================
window.showPersistentNotification = function(senderName, messageText) {
    const notifSender = document.getElementById('notif-sender');
    const notifText = document.getElementById('notif-text');
    const topNotification = document.getElementById('top-notification');
    
    if (!topNotification) return;
    
    if (topNotification.hideTimeout) {
        clearTimeout(topNotification.hideTimeout);
    }
    
    topNotification.classList.remove('hiding');
    
    if (notifSender) notifSender.innerText = senderName || "New Message";
    if (notifText) {
        let preview = messageText.length > 30 ? messageText.substring(0, 30) + '...' : messageText;
        notifText.innerText = preview;
    }
    
    topNotification.style.display = 'flex';
    
    topNotification.hideTimeout = setTimeout(() => {
        window.dismissNotification();
    }, 5000);
};

// ==========================================
// 1. START GROUP CHAT FUNCTION
// ==========================================
window.startGroupChat = function(groupId, groupName) {
    document.querySelector('.app-wrapper').classList.add('chat-active');
    window.history.pushState({ chatActive: true }, "");

    localStorage.setItem('activeChatType', 'group');
    localStorage.setItem('activeChatId', groupId);
    localStorage.setItem('activeChatName', groupName);

    document.getElementById('display-name').innerText = groupName;
    document.getElementById('typing-status').innerText = "Group Chat";
    document.getElementById('active-avatar').src = `https://ui-avatars.com/api/?name=${groupName}&background=128C7E&color=fff&rounded=true`;

    const chatWindow = document.getElementById('chat-window');
    const actualChatContainer = chatWindow ? chatWindow : document.querySelector('.conversation-area'); 
    actualChatContainer.innerHTML = ''; 

    fetch(`/api/group/${groupId}/messages/`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                const currentUserId = document.getElementById('current-user-id').value;
                data.messages.forEach(msg => {
                    const isMe = String(msg.sender_id) === String(currentUserId);
                    let msgContent = msg.content;
                    
                    let mediaHtml = msg.video_url ? `<video width="100%" style="max-width:250px; border-radius: 8px; margin-bottom: 5px;" controls><source src="${msg.video_url}" type="video/mp4"></video><br>` : '';

                    if (msgContent === "This message was deleted") {
                        msgContent = `<i class="fa-solid fa-ban" style="color:#888; margin-right:5px;"></i> <i style="color:#888;">This message was deleted</i>`;
                        mediaHtml = ''; 
                    } else if (!isMe) {
                        msgContent = mediaHtml + `<strong style="color: #128C7E; font-size: 12px;">${msg.sender_name}</strong><br>` + msgContent;
                    } else {
                        msgContent = mediaHtml + msgContent;
                    }
                    
                    const msgClass = isMe ? 'sent' : 'received';
                    let deleteBtn = (isMe && msg.content !== "This message was deleted") 
                        ? `<i class="fa-solid fa-trash" onclick="deleteMessage(${msg.id})" style="margin-left: 10px; cursor: pointer; font-size: 11px; color: #999;"></i>` 
                        : '';

                    actualChatContainer.innerHTML += `
                        <div class="message ${msgClass}" id="msg-${msg.id}">
                            <div class="msg-content">
                                ${msgContent}
                                <span class="msg-meta" style="float: right; margin-left: 10px; font-size: 11px; color: #999; margin-top: 5px; display: inline-block;">
                                    ${msg.timestamp} ${deleteBtn}
                                </span>
                            </div>
                        </div>`;
                });
                actualChatContainer.scrollTop = actualChatContainer.scrollHeight;
            }
        });

    if (chatSocket) chatSocket.close();
    const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
    chatSocket = new WebSocket(`${wsScheme}://${window.location.host}/ws/group/${groupId}/`);
    
    // 👉 THE FIX: addEventListener protects Group Chats!
    chatSocket.addEventListener('message', function(e) {
        const data = JSON.parse(e.data);
        
        console.log("🚨 TRACKER (Group): Message received from Django!", data);

        if (data.type === 'webrtc_offer') {
            console.log("📲 INCOMING CALL SIGNAL RECEIVED:", data.offer);
            if (confirm("Incoming Voice Call! Do you want to answer?")) {
                console.log("User accepted the call. Ready for Phase 3!");
            } else {
                console.log("User rejected the call.");
            }
            return; 
        }
            
        if (data.type === 'message_deleted') {
            const msgElement = document.getElementById(`msg-${data.message_id}`);
            if (msgElement) {
                msgElement.querySelector('.msg-content').innerHTML = `
                    <i class="fa-solid fa-ban" style="color:#888; margin-right:5px;"></i> 
                    <i style="color:#888;">This message was deleted</i>
                    <span class="msg-meta" style="float: right; margin-left: 10px; font-size: 11px; color: #999; margin-top: 5px;">
                        ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>`;
            }
            return; 
        }

        if (data.type === 'chat_message') {
            const currentUserId = document.getElementById('current-user-id').value;
            const isMe = String(data.sender_id) === String(currentUserId);
            
            let msgContent = data.message || '';
            let mediaHtml = data.video_url ? `<video width="100%" style="max-width:250px; border-radius: 8px; margin-bottom: 5px;" controls><source src="${data.video_url}" type="video/mp4"></video><br>` : '';

            if (!isMe) {
                let senderNameHtml = data.sender_name ? `<strong style="color: #128C7E; font-size: 12px;">${data.sender_name}</strong><br>` : '';
                msgContent = mediaHtml + senderNameHtml + msgContent;
            } else {
                msgContent = mediaHtml + msgContent;
            }

            const msgClass = isMe ? 'sent' : 'received';
            let deleteBtn = isMe ? `<i class="fa-solid fa-trash" onclick="deleteMessage(${data.message_id})" style="margin-left: 10px; cursor: pointer; font-size: 11px; color: #999;"></i>` : '';

            const messageHtml = `
                <div class="message ${msgClass}" id="msg-${data.message_id}">
                    <div class="msg-content">
                        ${msgContent}
                        <span class="msg-meta" style="float: right; margin-left: 10px; font-size: 11px; color: #999; margin-top: 5px; display: inline-block;">
                            ${data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${deleteBtn}
                        </span>
                    </div>
                </div>`;
            
            if (actualChatContainer) {
                actualChatContainer.innerHTML += messageHtml;
                actualChatContainer.scrollTop = actualChatContainer.scrollHeight;
            }

            if (!isMe && typeof window.showBrowserNotification === 'function') {
                window.showBrowserNotification(data.sender_name, data.message || "Video sent", null);
            }
        }
    }); 
};

// ==========================================
// 2. START PRIVATE CHAT FUNCTION
// ==========================================
window.startChat = function(userId, username) {
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    const currentChatItem = document.querySelector(`.chat-item[data-user-id='${userId}']`);
    if (currentChatItem) {
        currentChatItem.classList.add('active');
    }

    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    const badge = document.getElementById(`badge-${userId}`);
    if (badge) {
        badge.style.display = 'none';
    }
    document.querySelector('.app-wrapper').classList.add('chat-active');
    window.history.pushState({ chatActive: true }, "");

    activeUserId = userId;
    localStorage.setItem('activeChatType', 'user');
    localStorage.setItem('activeChatId', userId);
    localStorage.setItem('activeChatName', username);
    
    document.getElementById('display-name').innerText = username;
    document.getElementById('typing-status').innerText = "online";
    const avatar = document.getElementById('active-avatar');
    if (avatar) avatar.src = `https://ui-avatars.com/api/?name=${username}&background=random`;
    
    const chatBody = document.querySelector('.conversation-area');
    chatBody.innerHTML = ''; 
    lastSeenDate = null; 

    if (chatSocket) chatSocket.close();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = protocol + '//' + window.location.host + '/ws/chat/' + userId + '/';
    
    chatSocket = new WebSocket(url);

    chatSocket.onopen = function() {
        chatSocket.send(JSON.stringify({ 'mark_read': true }));
    };

    // 👉 THE FIX: addEventListener protects Private Chats too!
    chatSocket.addEventListener('message', function(e) {
        const data = JSON.parse(e.data);
        const myId = document.getElementById('current-user-id').value;

        console.log("🚨 TRACKER (Private): Message received from Django!", data);

        // 👉 THE FIX: Trigger the Full-Screen Ringtone UI!
        if (data.type === 'webrtc_offer') {
            console.log("📲 INCOMING CALL SIGNAL RECEIVED:", data.offer);
            
            // 1. Get the UI elements
            const callModal = document.getElementById('incoming-call-modal');
            const callerNameText = document.getElementById('caller-name-display');
            const callerAvatar = document.getElementById('caller-avatar');
            const ringtone = document.getElementById('ringtone-audio');
            
            // 2. Set the caller's name and picture
            const callerName = data.sender_name || "Unknown Caller";
            callerNameText.innerText = callerName;
            callerAvatar.src = `https://ui-avatars.com/api/?name=${callerName}&background=random`;
            
            // 3. Show the screen and play the ringtone!
            callModal.style.display = 'flex';
            ringtone.play().catch(e => console.log("Browser blocked autoplay. User must interact first.", e));
            
            return; 
        }

        // 👉 THE FIX: Hijack the working video call signal to trigger the Ringtone UI!
        if (data.type === 'incoming_video_call') {
            if (String(data.caller_id) !== String(myId)) { 
                // 1. Get the UI elements
                const callModal = document.getElementById('incoming-call-modal');
                const callerNameText = document.getElementById('caller-name-display');
                const callerAvatar = document.getElementById('caller-avatar');
                const ringtone = document.getElementById('ringtone-audio');
                
                // 2. Set the caller's info
                callerNameText.innerText = data.caller_name || "Unknown Caller";
                callerAvatar.src = `https://ui-avatars.com/api/?name=${data.caller_name || 'User'}&background=random`;
                
                // 3. Secretly attach the Room ID AND Call Type to the Accept button!
                const acceptBtn = document.getElementById('accept-call-btn');
                acceptBtn.setAttribute('data-room', data.room_id);
                acceptBtn.setAttribute('data-type', data.call_type || 'video'); // 👉 THIS IS THE NEW LINE!
                
                // 4. Show the screen and play the ringtone!
                callModal.style.display = 'flex';
                ringtone.play().catch(e => console.log("Browser blocked autoplay.", e));
            }
            return; 
        }
        
        if (data.type === 'message_deleted') {
            const msgElement = document.getElementById(`msg-${data.message_id}`);
            if (msgElement) {
                msgElement.querySelector('.msg-content').innerHTML = `
                    <i class="fa-solid fa-ban" style="color:#888; margin-right:5px;"></i> 
                    <i style="color:#888;">This message was deleted</i>
                    <span class="msg-meta" style="float: right; margin-left: 10px; font-size: 11px; color: #999; margin-top: 5px;">
                        ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>`;
            }
            return; 
        }

        if (data.type === 'read_receipt') {
            if (String(data.reader_id) !== String(myId)) {
                document.querySelectorAll('.fa-check-double').forEach(tick => {
                    tick.classList.add('text-blue'); 
                });
            }
            return; 
        }

        if (data.type === 'user_status') {
            if (String(data.user_id) !== String(myId)) {
                const statusText = document.getElementById('typing-status');
                if (statusText.innerText !== "typing...") {
                    statusText.innerText = data.is_online ? "online" : data.last_seen;
                    statusText.style.color = data.is_online ? "#00bfa5" : "#aaa";
                }
            }
            return; 
        }

        if (data.type === 'typing') {
            if (String(data.sender_id) !== String(myId)) {
                const statusText = document.getElementById('typing-status');
                if (data.is_typing) {
                    statusText.innerText = "typing...";
                    statusText.style.color = "#00bfa5"; 
                } else {
                    statusText.innerText = "online";
                    statusText.style.color = "#aaa";    
                }
            }
            return; 
        }

      
        if (data.type === 'chat_message' || data.type === 'message' || data.message) {
            
            // 1. Figure out if YOU sent it, or if THEY sent it
            const isMe = String(data.sender_id) === String(myId) || String(data.user) === String(myId);
            const type = isMe ? 'sent' : 'received';
            
            const today = new Date().toISOString().split('T')[0];
            const timeNow = data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // 2. Draw the bubble immediately!
            appendMessage(data.message, type, timeNow, today, false, data.message_id, data.video_url);

            // 3. Handle notifications if it's from the other person
            if (type === 'received') {
                chatSocket.send(JSON.stringify({ 'mark_read': true }));
                const senderName = data.sender_name || localStorage.getItem('activeChatName'); 
                window.showBrowserNotification(senderName, data.message || "Video sent", activeUserId);
            }
        }
    
    });

    fetch(`/api/messages/${userId}/`)
    .then(res => res.json())
    .then(data => {
        console.log("📚 HISTORY X-RAY: Look what I got from the database:", data);
        
        const myId = document.getElementById('current-user-id').value;
        
        try {
            data.forEach(msg => {
                const type = (msg.sender_id == myId) ? 'sent' : 'received';
                // Try to draw the message
                appendMessage(msg.content, type, msg.timestamp, msg.date, msg.is_read, msg.id, msg.video_url);
            });
            console.log("✅ History successfully drawn on screen!");
        } catch (error) {
            console.error("❌ HISTORY CRASH: Failed to draw a message!", error);
        }
    })
    .catch(error => {
        console.error("❌ FETCH CRASH: Failed to talk to the database!", error);
    });
}; // <-- Make sure this closing bracket is still here!

// ==========================================
// 3. SEND, APPEND & DELETE MESSAGE LOGIC
// ==========================================
function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim(); 
    
    if (message.length > 0 && chatSocket) {
        
        chatSocket.send(JSON.stringify({ 'message': message }));

        
        const today = new Date().toISOString().split('T')[0];
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        appendMessage(message, 'sent', timeNow, today, false, null, null);

        
        input.value = '';
    }
}

window.ringFriend = function() {
    if (!activeUserId) {
        alert("Please select a contact to call first!");
        return;
    }
    
    const callRoomId = crypto.randomUUID(); 
    
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({
            'type': 'video_call_init',
            'room_id': callRoomId
        }));
        window.location.href = `/videocalls/${callRoomId}/?caller=1`; 
    } else {
        alert("Chat connection is offline. Cannot start call.");
    }
};

window.deleteMessage = function(msgId) {
    if (confirm("Delete this message for everyone?")) {
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({ 
                'action': 'delete_message', 
                'message_id': msgId 
            }));
        }
    }
};

function appendMessage(text, type, time = null, date = null, isRead = false, msgId = null, videoUrl = null) {
    const chatBody = document.querySelector('.conversation-area');
    
    if (date && date !== lastSeenDate) {
        const separator = document.createElement('div');
        separator.classList.add('date-separator');
        let label = date;
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        if (date === today) label = "Today";
        else if (date === yesterday) label = "Yesterday";
        separator.innerHTML = `<span>${label}</span>`;
        chatBody.appendChild(separator);
        lastSeenDate = date; 
    }

    let contentHtml = '';
    
    if (text === "This message was deleted") {
        contentHtml = `<i class="fa-solid fa-ban" style="color:#888; margin-right:5px;"></i> <i style="color:#888;">This message was deleted</i>`;
    } 
    else if (videoUrl) {
        contentHtml = `
            <video width="100%" style="max-width: 250px; border-radius: 8px; margin-bottom: 5px;" controls>
                <source src="${videoUrl}" type="video/mp4">
                Your browser does not support the video tag.
            </video>
            ${text ? `<div style="margin-top: 5px;">${text}</div>` : ''}
        `;
    } 
    else if (text && (text.startsWith('/media/') || text.startsWith('http') || text.match(/\.(jpeg|jpg|gif|png)$/) != null)) {
        contentHtml = `<img src="${text}" style="max-width: 100%; height: auto; display: block; border-radius: 8px; cursor: pointer; margin-bottom: 5px;" onclick="window.open(this.src)">`;
    } 
    else {
        contentHtml = text || ''; 
    }

    let tickHtml = '';
    let deleteBtnHtml = ''; 
    
    if (type === 'sent') {
        const tickClass = isRead ? 'text-blue' : ''; 
        tickHtml = `<i class="fa-solid fa-check-double ${tickClass}" style="margin-left: 5px;"></i>`;
        
        if (msgId && text !== "This message was deleted") {
            deleteBtnHtml = `<i class="fa-solid fa-trash" onclick="deleteMessage(${msgId})" style="margin-left: 10px; cursor: pointer; font-size: 11px; color: #999;" title="Delete for everyone"></i>`;
        }
    }

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', type);
    
    if (msgId) {
        messageDiv.id = `msg-${msgId}`; 
    }
    
    const timeString = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    messageDiv.innerHTML = `
        <div class="msg-content">
            ${contentHtml}
            <span class="msg-meta" style="float: right; margin-left: 10px; font-size: 11px; color: #999; margin-top: 5px; display: inline-block;">
                ${timeString} ${tickHtml} ${deleteBtnHtml}
            </span>
        </div>`;
    
    chatBody.appendChild(messageDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
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

window.uploadVideoMessage = async function(file) {
    const formData = new FormData();
    formData.append('video', file);
    
    const activeType = localStorage.getItem('activeChatType');
    const activeId = localStorage.getItem('activeChatId');
    formData.append('room_id', activeId); 
    formData.append('chat_type', activeType); 
    formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));

    const chatLog = document.querySelector('.conversation-area');
    const tempId = 'temp-' + Date.now();
    
    chatLog.innerHTML += `<div id="${tempId}" class="message sent"><div class="msg-content"><i><i class="fa-solid fa-spinner fa-spin"></i> Uploading video...</i></div></div>`;
    chatLog.scrollTop = chatLog.scrollHeight;

    try {
        const response = await fetch('/send_message/', {
            method: 'POST',
            body: formData,
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        });
        const data = await response.json();
        
        const tempMsg = document.getElementById(tempId);
        if (tempMsg) tempMsg.remove();
        
        if (data.status === 'success') {
            const today = new Date().toISOString().split('T')[0];
            const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            appendMessage(data.message_content || '', 'sent', timeString, today, false, data.message_id || null, data.video_url);

            if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
                chatSocket.send(JSON.stringify({ 
                    'message': data.message_content || '',
                    'video_url': data.video_url,
                    'is_video': true
                }));
            }
        } else {
            alert("Upload failed: " + (data.error || "Unknown error"));
        }
    } catch (error) {
        console.error("Upload Error:", error);
        const tempMsg = document.getElementById(tempId);
        if (tempMsg) tempMsg.innerHTML = "Upload failed.";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const msgInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    const activeType = localStorage.getItem('activeChatType');
    const activeId = localStorage.getItem('activeChatId');
    const activeName = localStorage.getItem('activeChatName');

   if (window.innerWidth > 768) {
        if (activeType && activeId && activeName) {
            if (activeType === 'group') startGroupChat(activeId, activeName);
            else if (activeType === 'user') startChat(activeId, activeName);
        }
    } else {
        localStorage.removeItem('activeChatType');
        localStorage.removeItem('activeChatId');
        localStorage.removeItem('activeChatName');
        
        const appWrapper = document.querySelector('.app-wrapper');
        if (appWrapper) {
            appWrapper.classList.remove('chat-active');
        }
    }

    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (msgInput) {
        msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    }

    const videoInput = document.getElementById('video-input');
    if (videoInput) {
        videoInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                if (this.files[0].size > 20 * 1024 * 1024) {
                    alert("Please select a video under 20MB.");
                } else {
                    uploadVideoMessage(this.files[0]);
                }
            }
            this.value = ''; 
        });
    }

    const emojiBtn = document.querySelector('#emoji-btn');
    if (emojiBtn && msgInput) {
        const picker = new EmojiButton({ theme: 'auto', position: 'top-start', zIndex: 999999 });
        picker.on('emoji', emoji => {
            msgInput.value += emoji; 
            msgInput.focus(); 
        });
        emojiBtn.addEventListener('click', (e) => { e.preventDefault(); picker.togglePicker(emojiBtn); });
    }

    const menuBtn = document.getElementById('menu-btn');
    const mainMenu = document.getElementById('main-menu');
    if (menuBtn) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = mainMenu.style.display === 'block';
            mainMenu.style.display = isVisible ? 'none' : 'block';
        });
    }
    document.addEventListener('click', () => { if (mainMenu) mainMenu.style.display = 'none'; });
    
    const bellIcon = document.getElementById('enable-notif-btn');
    if (bellIcon) {
        bellIcon.style.cursor = 'pointer';
        bellIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            subscribeToPush();
        });
    }
    
    if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    console.log("System notifications enabled!");
                }
            });
        }
    }

    const newChatBtn = document.getElementById('new-chat-btn');
    const newChatModal = document.getElementById('new-chat-modal');
    const closeNewChatBtn = document.getElementById('close-new-chat-btn');

    if (newChatBtn) newChatBtn.addEventListener('click', () => newChatModal.style.display = 'flex');
    if (closeNewChatBtn) closeNewChatBtn.addEventListener('click', () => newChatModal.style.display = 'none');
    window.startNewChat = function(userId, username) {
        newChatModal.style.display = 'none'; 
        startChat(userId, username);        
    };

    const groupBtn = document.getElementById('create-group-btn');
    const groupModal = document.getElementById('group-modal');
    const cancelGroupBtn = document.getElementById('cancel-group-btn');
    const saveGroupBtn = document.getElementById('save-group-btn');

    if (groupBtn) groupBtn.addEventListener('click', () => groupModal.style.display = 'flex');
    if (cancelGroupBtn) {
        cancelGroupBtn.addEventListener('click', () => {
            groupModal.style.display = 'none';
            document.getElementById('group-name').value = '';
            document.querySelectorAll('.group-member-cb').forEach(cb => cb.checked = false);
        });
    }

    if (saveGroupBtn) {
        saveGroupBtn.addEventListener('click', () => {
            const name = document.getElementById('group-name').value.trim();
            const members = Array.from(document.querySelectorAll('.group-member-cb:checked')).map(cb => cb.value);
            if (!name || members.length === 0) return alert("Please fill name and select members!");

            saveGroupBtn.innerText = "Creating...";
            fetch('/api/create-group/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
                body: JSON.stringify({ name, members })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') window.location.reload();
                else alert("Error: " + data.message);
            });
        });
    }

    const fileInput = document.getElementById('image-upload');
    if (fileInput) {
        fileInput.addEventListener('change', function() {
            const file = this.files[0];
            if (!file) return;
            const formData = new FormData();
            formData.append('image', file);
            fetch('/api/upload/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrftoken') },
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success' && chatSocket) {
                    chatSocket.send(JSON.stringify({ 'message': data.image_url, 'is_image': true }));
                }
            });
            this.value = ''; 
        });
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchValue = this.value.toLowerCase(); 
            const chatItems = document.querySelectorAll('.chat-list .chat-item');

            chatItems.forEach(item => {
                const nameElement = item.querySelector('.contact-name');
                if (nameElement) {
                    const nameText = nameElement.innerText.toLowerCase();
                    if (nameText.includes(searchValue)) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                }
            });
        });
    }

    const statusBtn = document.getElementById('status-btn');
    const statusModal = document.getElementById('status-modal');
    const closeStatusBtn = document.getElementById('close-status-btn');
    const statusUpload = document.getElementById('status-upload');
    const statusListContainer = document.getElementById('status-list-container');
    const statusViewer = document.getElementById('status-viewer');

    if (statusBtn) {
        statusBtn.addEventListener('click', () => {
            statusModal.style.display = 'flex';
            loadStatuses(); 
            window.history.pushState({ modalOpen: 'status' }, "");
        });
    }

    if (closeStatusBtn) {
        closeStatusBtn.addEventListener('click', () => {
            window.history.back(); 
        });
    }

    function loadStatuses() {
        fetch('/api/status/list/')
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    statusListContainer.innerHTML = '';
                    
                    data.data.forEach(userDict => {
                        const userDiv = document.createElement('div');
                        userDiv.style = "display: flex; align-items: center; padding: 15px; cursor: pointer; border-bottom: 1px solid #333; transition: background 0.2s;";
                        
                        userDiv.innerHTML = `
                            <div style="border: 3px solid #00bfa5; border-radius: 50%; padding: 2px; margin-right: 15px;">
                                <img src="${userDict.avatar}" style="width: 45px; height: 45px; border-radius: 50%; display: block;">
                            </div>
                            <div>
                                <h4 style="margin: 0; color: white; font-size: 16px;">${userDict.username}</h4>
                                <p style="margin: 5px 0 0 0; font-size: 13px; color: #aaa;">${userDict.statuses.length} update(s)</p>
                            </div>
                        `;
                        
                       userDiv.onclick = () => {
                            const latestStatus = userDict.statuses[0]; 
                            let deleteBtnHtml = '';
                            if (userDict.is_me) {
                                deleteBtnHtml = `<i class="fa-solid fa-trash" onclick="deleteStatus(${latestStatus.id})" style="position: absolute; top: 20px; right: 20px; color: #ff4444; font-size: 20px; cursor: pointer; z-index: 1000;" title="Delete Status"></i>`;
                            }

                            statusViewer.innerHTML = `
                                <div style="text-align: center; color: white; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; background: #000; position: relative;">
                                    ${deleteBtnHtml}
                                    <div style="width: 100%; padding: 20px; text-align: left; position: absolute; top: 0; left: 0;">
                                        <h3 style="margin: 0;">${userDict.username}</h3>
                                        <p style="color: #aaa; margin: 5px 0 0 0;">${latestStatus.time}</p>
                                    </div>
                                    <img src="${latestStatus.image_url}" style="max-width: 90%; max-height: 80vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                                </div>
                            `;
                        };
                        
                        statusListContainer.appendChild(userDiv);
                    });
                }
            });
    }

    if (statusUpload) {
        statusUpload.addEventListener('change', function() {
            const file = this.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('status_image', file);
            
            fetch('/api/status/upload/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrftoken') },
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    alert("Status uploaded successfully! It will disappear in 24 hours.");
                    loadStatuses(); 
                } else {
                    alert("Upload failed: " + data.message);
                }
            });
            this.value = ''; 
        });
    }

    window.deleteStatus = function(statusId) {
        if (confirm("Are you sure you want to delete this status?")) {
            fetch(`/api/status/delete/${statusId}/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    document.getElementById('status-viewer').innerHTML = `
                        <div style="text-align: center; color: #aaa;">
                            <i class="fa-solid fa-circle-notch" style="font-size: 50px; margin-bottom: 20px;"></i>
                            <h2>Click on a contact to view their status</h2>
                        </div>`;
                    loadStatuses(); 
                } else {
                    alert(data.message);
                }
            });
        }
    };

    let typingTimer;
    const chatInputBox = document.getElementById('message-input');

    if (chatInputBox) {
        chatInputBox.addEventListener('input', () => {
            if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
                chatSocket.send(JSON.stringify({ 'typing': true }));
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    chatSocket.send(JSON.stringify({ 'typing': false }));
                }, 2000);
            }
        });
    }

    // --- L. NATIVE MOBILE BACK BUTTON OVERRIDE ---
    const backBtn = document.getElementById('back-btn');
    const appWrapper = document.querySelector('.app-wrapper');

    window.onpopstate = function(event) {
        const statusModal = document.getElementById('status-modal');
        if (statusModal && statusModal.style.display === 'flex') {
            statusModal.style.display = 'none'; 
            
            const statusViewer = document.getElementById('status-viewer');
            if (statusViewer) {
                statusViewer.innerHTML = `
                    <div style="text-align: center; color: #aaa;">
                        <i class="fa-solid fa-circle-notch" style="font-size: 50px; margin-bottom: 20px;"></i>
                        <h2>Click on a contact to view their status</h2>
                    </div>`;
            }
            return; 
        }

        if (appWrapper && appWrapper.classList.contains('chat-active')) {
            appWrapper.classList.remove('chat-active');
        }
    };

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            appWrapper.classList.remove('chat-active');
            window.history.back();
            
            if (window.innerWidth <= 768) {
                localStorage.removeItem('activeChatType');
                localStorage.removeItem('activeChatId');
                localStorage.removeItem('activeChatName');
            }
        });
    }
});

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function checkPushSubscription() {
    const bellIcon = document.getElementById('enable-notif-btn');
    const floatingBtn = document.getElementById('floating-notif-btn');
    
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.ready.then(function(registration) {
            registration.pushManager.getSubscription().then(function(subscription) {
                if (subscription) {
                    if (floatingBtn) {
                        floatingBtn.style.display = 'none';
                    }
                    if (bellIcon) {
                        bellIcon.classList.remove('fa-bell');
                        bellIcon.classList.add('fa-bell-slash');
                        bellIcon.style.color = "#25D366";
                        bellIcon.title = "Notifications Enabled";
                    }
                }
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', checkPushSubscription);

window.testPushNotification = function() {
    alert("This button is for testing only. Use the green bell button to enable notifications.");
};

window.subscribeToPush = function() {
    const bellIcon = document.getElementById('enable-notif-btn');
    const floatingBtn = document.getElementById('floating-notif-btn');
    
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert("Your browser doesn't support push notifications.");
        return;
    }
    
    Notification.requestPermission().then(permission => {
        if (permission !== 'granted') {
            alert('Please allow notification permission to receive messages when app is closed.');
            return;
        }
        
        navigator.serviceWorker.ready.then(function(registration) {
            const vapidPublicKey = 'BNzKqc3nOoaTFYmrghrO0rfMV2xnWSFJmtCbwfVYJWRN_EyB5ZgAeecCEyMzy1KPs2NVTw-tzEtgFULQ0MO9giE'; 
            const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

            registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey
            }).then(function(subscription) {
                
                fetch('/api/save-subscription/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify(subscription)
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success') {
                        if (floatingBtn) {
                            floatingBtn.style.display = 'none';
                        }
                        
                        if (bellIcon) {
                            bellIcon.classList.remove('fa-bell');
                            bellIcon.classList.add('fa-bell-slash');
                            bellIcon.style.color = "#25D366";
                        }
                        
                        window.showPersistentNotification("Notifications Enabled", "You'll receive messages even when app is closed!");
                    } else {
                        alert('Error enabling notifications. Please try again.');
                    }
                })
                .catch(err => {
                    console.error("Server Error:", err);
                    alert('Failed to save subscription. Please try again.');
                });

            }).catch(function(err) {
                console.error('Push subscription failed:', err);
                alert('Failed to enable notifications. Please try again.');
            });
        }).catch(function(err) {
            console.error('Service Worker not ready:', err);
            alert('Service Worker not ready. Please refresh and try again.');
        });
    });
};

// ==========================================
// VOICE CALL LOGIC (WebRTC Phase 1 & 2)
// ==========================================
// ==========================================
// START VOICE CALL BUTTON
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const callBtn = document.getElementById('start-voice-call');
    
    if (callBtn) {
        callBtn.addEventListener('click', () => {
            const activeId = localStorage.getItem('activeChatId');
            if (!activeId) {
                alert("Please select a user to call first!");
                return;
            }

            // Create a secure room and use the signal Django already understands!
            const callRoomId = crypto.randomUUID(); 
            if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
                chatSocket.send(JSON.stringify({
                    'type': 'video_call_init',
                    'room_id': callRoomId,
                    'call_type': 'voice'
                }));
                // Send the caller to the room to wait
                window.location.href = `/videocalls/${callRoomId}/?caller=1&type=voice`; 
            } else {
                alert("Chat connection is offline. Cannot start call.");
            }
        });
    }


    // ==========================================
    // CALL BUTTON LOGIC (Accept / Decline)
    // ==========================================
    const acceptBtn = document.getElementById('accept-call-btn');
    const declineBtn = document.getElementById('decline-call-btn');
    const callModal = document.getElementById('incoming-call-modal');
    const ringtone = document.getElementById('ringtone-audio');

    if (acceptBtn) {
        acceptBtn.addEventListener('click', function() {
            ringtone.pause();
            ringtone.currentTime = 0;
            callModal.style.display = 'none';
            
            const roomId = this.getAttribute('data-room');
            const callType = this.getAttribute('data-type') || 'video';
            
            // 👉 Pass the type to the URL when answering!
            window.location.href = `/videocalls/${roomId}/?caller=0&type=${callType}`;
        });
    }

    if (declineBtn) {
        declineBtn.addEventListener('click', () => {
            // Stop the ringing and hide screen
            ringtone.pause();
            ringtone.currentTime = 0;
            callModal.style.display = 'none';
        });
    }
});
let chatSocket = null;
let activeUserId = null;
let lastSeenDate = null;




// ==========================================
// 0. NOTIFICATION LOGIC
// ==========================================
window.showPersistentNotification = function(senderName, messageText) {
    // 1. Show the Green UI Banner (For when they are staring at the app)
    document.getElementById('notif-sender').innerText = senderName || "New Message";
    let preview = messageText.length > 30 ? messageText.substring(0, 30) + '...' : messageText;
    document.getElementById('notif-text').innerText = preview;
    document.getElementById('top-notification').style.display = 'flex';

    // 2. Fire the OS System Notification (For when they are on another tab/minimized)
    if ("Notification" in window && Notification.permission === "granted") {
        // 'document.hidden' checks if the user is currently looking at a different tab or app
        if (document.hidden) { 
            const osNotification = new Notification(senderName || "New Message", {
                body: messageText,
                icon: '/static/icon-192.png' // Uses the mobile app icon you made earlier!
            });
            
            // If they click the OS notification, it brings them back to your chat tab!
            osNotification.onclick = function() {
                window.focus();
                this.close();
            };
        }
    }
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
                    
                    if (msgContent === "This message was deleted") {
                        msgContent = `<i class="fa-solid fa-ban" style="color:#888; margin-right:5px;"></i> <i style="color:#888;">This message was deleted</i>`;
                    } else if (!isMe) {
                        msgContent = `<strong style="color: #128C7E; font-size: 12px;">${msg.sender_name}</strong><br>` + msgContent;
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
    
    chatSocket.onmessage = function(e) {
        const data = JSON.parse(e.data);
        
        // --- 1. INTERCEPT DELETED MESSAGE ---
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

        // --- 2. PROCESS NORMAL GROUP MESSAGE ---
        const currentUserId = document.getElementById('current-user-id').value;
        const isMe = String(data.sender_id) === String(currentUserId);
        
        let msgContent = data.message;
        if (!isMe) {
            msgContent = `<strong style="color: #128C7E; font-size: 12px;">${data.sender_name}</strong><br>` + msgContent;
        }

        const msgClass = isMe ? 'sent' : 'received';
        let deleteBtn = isMe ? `<i class="fa-solid fa-trash" onclick="deleteMessage(${data.message_id})" style="margin-left: 10px; cursor: pointer; font-size: 11px; color: #999;"></i>` : '';

        const messageHtml = `
            <div class="message ${msgClass}" id="msg-${data.message_id}">
                <div class="msg-content">
                    ${msgContent}
                    <span class="msg-meta" style="float: right; margin-left: 10px; font-size: 11px; color: #999; margin-top: 5px; display: inline-block;">
                        ${data.timestamp} ${deleteBtn}
                    </span>
                </div>
            </div>`;
        
        actualChatContainer.innerHTML += messageHtml;
        actualChatContainer.scrollTop = actualChatContainer.scrollHeight;

        // 👉 TRIGGER BANNER ONLY IF SOMEONE ELSE SENT IT
        if (!isMe) {
            window.playNotificationSound();
            window.showPersistentNotification(data.sender_name, data.message);
        }
    };
};

// ==========================================
// 2. START PRIVATE CHAT FUNCTION
// ==========================================
window.startChat = function(userId, username) {
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

    chatSocket.onmessage = function(e) {
        const data = JSON.parse(e.data);
        const myId = document.getElementById('current-user-id').value;
        
        // --- 1. INTERCEPT DELETED MESSAGE ---
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

        // --- 2. INTERCEPT READ RECEIPT ---
        if (data.type === 'read_receipt') {
            if (String(data.reader_id) !== String(myId)) {
                document.querySelectorAll('.fa-check-double').forEach(tick => {
                    tick.classList.add('text-blue'); 
                });
            }
            return; 
        }

        // --- 3. INTERCEPT ONLINE / LAST SEEN STATUS ---
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

        // --- 4. INTERCEPT TYPING ---
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

        // --- 5. NORMAL MESSAGE ---
        const type = (data.sender_id == myId) ? 'sent' : 'received';
        const today = new Date().toISOString().split('T')[0];
        
        appendMessage(data.message, type, null, today, false, data.message_id);

        if (type === 'received') {
            chatSocket.send(JSON.stringify({ 'mark_read': true }));
            
            // 👉 TRIGGER NOTIFICATION BANNER
            window.playNotificationSound();
            const senderName = data.sender_name || localStorage.getItem('activeChatName'); 
            window.showPersistentNotification(senderName, data.message);
        }
    };

    fetch(`/api/messages/${userId}/`)
    .then(res => res.json())
    .then(data => {
        const myId = document.getElementById('current-user-id').value;
        data.forEach(msg => {
            const type = (msg.sender_id == myId) ? 'sent' : 'received';
            appendMessage(msg.content, type, msg.timestamp, msg.date, msg.is_read, msg.id);
        });
    });
};

// ==========================================
// 3. SEND, APPEND & DELETE MESSAGE LOGIC
// ==========================================
function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value; 
    if (message.length > 0 && chatSocket) {
        chatSocket.send(JSON.stringify({ 'message': message }));
        input.value = '';
    }
}

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

function appendMessage(text, type, time = null, date = null, isRead = false, msgId = null) {
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
    } else if (text && (text.startsWith('/media/') || text.startsWith('http') || text.match(/\.(jpeg|jpg|gif|png)$/) != null)) {
        contentHtml = `<img src="${text}" style="max-width: 100%; height: auto; display: block; border-radius: 8px; cursor: pointer; margin-bottom: 5px;" onclick="window.open(this.src)">`;
    } else {
        contentHtml = text; 
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

// ==========================================
// 4. UTILITIES & INITIALIZATION
// ==========================================
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

// This is a math utility browsers require to read your VAPID key safely
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

// The function that asks the phone for a Push Token
function subscribeToPush() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.ready.then(function(registration) {
            
            // 🛑 PASTE YOUR PUBLIC VAPID KEY HERE 🛑
            const vapidPublicKey = "*****example_publicKey_*******"; 
            
            const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

            registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey
            }).then(function(subscription) {
                // We got the token! Now send it to Django.
                fetch('/api/save-subscription/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify(subscription)
                });
            }).catch(function(err) {
                console.log('Failed to subscribe the user: ', err);
            });
        });
    }
}
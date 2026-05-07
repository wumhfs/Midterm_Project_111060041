import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
    getFirestore, collection, query, where, onSnapshot,
    addDoc, serverTimestamp, doc, updateDoc, deleteDoc, getDocs, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useNavigate } from 'react-router-dom';
import app from '../firebase';
import './ChatRoom.css';

export default function Chat() {
    const { currentUser, logout } = useAuth();
    const navigate = useNavigate();
    const db = getFirestore(app);
    const storage = getStorage(app);

    // ================= 狀態管理 =================
    const [rooms, setRooms] = useState([]);
    const [currentRoom, setCurrentRoom] = useState(null);
    const [messages, setMessages] = useState([]);
    const [usersCache, setUsersCache] = useState({});

    // 輸入與操作狀態
    const [inputText, setInputText] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [editingMsgId, setEditingMsgId] = useState(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [replyToMsg, setReplyToMsg] = useState(null);
    const [highlightMsgId, setHighlightMsgId] = useState(null);
    const messagesEndRef = useRef(null);

    useEffect(() => {
        const unsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
            const cache = {};
            snapshot.forEach(doc => {
                cache[doc.id] = doc.data();
            });
            setUsersCache(cache);
        });
        return () => unsubscribe();
    }, [db]);

    useEffect(() => {
        if (!currentUser) return;
        const q = query(collection(db, "rooms"), where("members", "array-contains", currentUser.uid));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const roomData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRooms(roomData);
        });
        return () => unsubscribe();
    }, [currentUser, db]);

    useEffect(() => {
        if (!currentRoom) return;
        const q = query(collection(db, `rooms/${currentRoom.id}/messages`));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            msgData.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
            setMessages(msgData);
            scrollToBottom();
        });
        return () => unsubscribe();
    }, [currentRoom, db]);

    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

    useEffect(function () {
        scrollToBottom();
    }, [messages]);

    const currentRoomIdRef = useRef(null);
    const usersCacheRef = useRef({});
    const notifiedMsgsRef = useRef(new Set());

    useEffect(() => { currentRoomIdRef.current = currentRoom?.id; }, [currentRoom]);
    useEffect(() => { usersCacheRef.current = usersCache; }, [usersCache]);

    useEffect(() => {
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => {
        if (!currentUser || rooms.length === 0) return;

        const unsubscribes = rooms.map(room => {
            const q = query(collection(db, `rooms/${room.id}/messages`));
            return onSnapshot(q, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added") {
                        const msg = change.doc.data();
                        const msgId = change.doc.id;

                        if (msg.senderId === currentUser.uid) return;
                        if (notifiedMsgsRef.current.has(msgId)) return;
                        notifiedMsgsRef.current.add(msgId);

                        const isNotCurrentRoom = currentRoomIdRef.current !== room.id;
                        if (isNotCurrentRoom || document.hidden) {
                            const now = Date.now();
                            const msgTime = msg.timestamp ? msg.timestamp.toMillis() : now;
                            if (now - msgTime < 10000 && "Notification" in window && Notification.permission === "granted") {
                                const senderInfo = usersCacheRef.current[msg.senderId] || {};
                                const senderName = senderInfo.username || senderInfo.email || "某人";
                                const text = msg.type === 'text' ? msg.text : '[圖片]';
                                new Notification(`來自 ${room.name} 的新訊息`, {
                                    body: `${senderName}: ${text}`,
                                    icon: senderInfo.profilePicture || undefined
                                });
                            }
                        }
                    }
                });
            });
        });

        return () => unsubscribes.forEach(unsub => unsub());
    }, [currentUser, rooms, db]);

    async function handleCreateRoom() {
        const roomName = prompt("請輸入新聊天室/群組名稱：");
        if (!roomName) return;
        await addDoc(collection(db, "rooms"), {
            name: roomName,
            members: [currentUser.uid],
            createdAt: serverTimestamp()
        });
    }

    async function handleBlockUser(targetUserId) {
        if (!window.confirm("確定要封鎖此使用者嗎？封鎖後將無法再互相接收訊息。")) return;
        try {
            await updateDoc(doc(db, "users", currentUser.uid), {
                blockedUsers: arrayUnion(targetUserId)
            });
        } catch (error) {
            alert("封鎖失敗：" + error.message);
        }
    }

    async function handleUnblockUser(targetUserId) {
        if (!window.confirm("確定要解除封鎖嗎？")) return;
        try {
            await updateDoc(doc(db, "users", currentUser.uid), {
                blockedUsers: arrayRemove(targetUserId)
            });
        } catch (error) {
            alert("解除封鎖失敗：" + error.message);
        }
    }

    async function handleInviteMember() {
        if (!currentRoom) return;
        const inviteEmail = prompt("請輸入欲邀請使用者的 Email：");
        if (!inviteEmail) return;

        let targetUserId = null;
        const userIds = Object.keys(usersCache);
        for (let i = 0; i < userIds.length; i++) {
            const uid = userIds[i];
            if (usersCache[uid].email === inviteEmail) {
                targetUserId = uid;
                break;
            }
        }

        if (targetUserId) {
            await updateDoc(doc(db, "rooms", currentRoom.id), { members: arrayUnion(targetUserId) });
            alert("邀請成功！");
        } else {
            alert("找不到該使用者。");
        }
    }

    async function handleSendMessage(e) {
        e.preventDefault();
        if (!inputText.trim() || !currentRoom) return;

        if (editingMsgId) {
            await updateDoc(doc(db, "rooms/" + currentRoom.id + "/messages", editingMsgId), { text: inputText, isEdited: true });
            setEditingMsgId(null);
        } else {
            let replyData = null;
            if (replyToMsg) {
                replyData = {
                    id: replyToMsg.id,
                    senderId: replyToMsg.senderId,
                    type: replyToMsg.type,
                    text: replyToMsg.text || null,
                    imageUrl: replyToMsg.imageUrl || null
                };
            }
            await addDoc(collection(db, "rooms/" + currentRoom.id + "/messages"), {
                text: inputText, senderId: currentUser.uid, timestamp: serverTimestamp(), type: 'text', replyTo: replyData
            });
        }
        setInputText('');
        setReplyToMsg(null);
    }

    async function handleSendImage(e) {
        const file = e.target.files[0];
        if (!file || !currentRoom) return;
        setUploadingImage(true);
        try {
            const imageRef = ref(storage, "chat_images/" + currentRoom.id + "/" + Date.now() + "_" + file.name);
            await uploadBytes(imageRef, file);
            const downloadUrl = await getDownloadURL(imageRef);
            let replyData = null;
            if (replyToMsg) {
                replyData = {
                    id: replyToMsg.id,
                    senderId: replyToMsg.senderId,
                    type: replyToMsg.type,
                    text: replyToMsg.text || null,
                    imageUrl: replyToMsg.imageUrl || null
                };
            }
            await addDoc(collection(db, "rooms/" + currentRoom.id + "/messages"), {
                imageUrl: downloadUrl, senderId: currentUser.uid, timestamp: serverTimestamp(), type: 'image', replyTo: replyData
            });
            setReplyToMsg(null);
        } catch (error) {
            alert("圖片發送失敗：" + error.message);
        } finally {
            setUploadingImage(false);
        }
    }

    async function handleDeleteMessage(msgId) {
        if (window.confirm("確定要收回這則訊息嗎？")) {
            await deleteDoc(doc(db, "rooms/" + currentRoom.id + "/messages", msgId));
        }
    }

    function startEditing(msg) {
        setEditingMsgId(msg.id);
        setInputText(msg.text);
    }

    function startReplying(msg) {
        setReplyToMsg(msg);
    }

    function cancelReplying() {
        setReplyToMsg(null);
    }

    function scrollToOriginalMessage(msgId) {
        const el = document.getElementById("msg-" + msgId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlightMsgId(msgId);
            setTimeout(function () {
                setHighlightMsgId(null);
            }, 2000);
        } else {
            alert("找不到該則原始訊息，可能已被收回或尚未載入。");
        }
    }

    async function handleLogout() {
        await logout();
        navigate('/');
    }

    function handleSearchChange(e) {
        setSearchQuery(e.target.value);
    }

    function handleInputChange(e) {
        setInputText(e.target.value);
    }

    function cancelEditing() {
        setEditingMsgId(null);
        setInputText('');
    }

    function navigateToProfile() {
        navigate('/profile');
    }

    function clearCurrentRoom() {
        setCurrentRoom(null);
    }

    const filteredMessages = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.type === 'text') {
            if (msg.text.toLowerCase().includes(searchQuery.toLowerCase())) {
                filteredMessages.push(msg);
            }
        }
    }

    let chatLayoutClass = "chat-layout";
    if (currentRoom) {
        chatLayoutClass = chatLayoutClass + " room-active";
    }

    let roomListElements = [];
    for (let i = 0; i < rooms.length; i++) {
        let room = rooms[i];
        let roomClassName = "room-item";
        if (currentRoom) {
            if (currentRoom.id === room.id) {
                roomClassName = roomClassName + " active";
            }
        }

        let roomNameText = room.name;
        if (!roomNameText) {
            roomNameText = "未命名群組";
        }

        roomListElements.push(
            <div
                key={room.id}
                className={roomClassName}
                onClick={function () { setCurrentRoom(room); }}
            >
                {roomNameText}
            </div>
        );
    }

    let mainChatContent = null;
    if (currentRoom) {
        let isDirectMessage = false;
        let otherUserId = null;
        let totalOtherMembers = 0;
        let blockedOtherMembers = 0;
        let iBlockedThemCount = 0;

        if (currentRoom.members) {
            if (currentRoom.members.length === 2) {
                isDirectMessage = true;
            }

            for (let i = 0; i < currentRoom.members.length; i++) {
                let memberId = currentRoom.members[i];
                if (memberId !== currentUser.uid) {
                    totalOtherMembers++;
                    if (isDirectMessage) {
                        otherUserId = memberId;
                    }

                    let myBlocked = [];
                    if (usersCache[currentUser.uid] && usersCache[currentUser.uid].blockedUsers) {
                        myBlocked = usersCache[currentUser.uid].blockedUsers;
                    }

                    let theirBlocked = [];
                    if (usersCache[memberId] && usersCache[memberId].blockedUsers) {
                        theirBlocked = usersCache[memberId].blockedUsers;
                    }

                    let iBlockedThem = myBlocked.includes(memberId);
                    let theyBlockedMe = theirBlocked.includes(currentUser.uid);

                    if (iBlockedThem || theyBlockedMe) {
                        blockedOtherMembers++;
                        if (iBlockedThem) {
                            iBlockedThemCount++;
                        }
                    }
                }
            }
        }

        let allBlocked = (totalOtherMembers > 0 && blockedOtherMembers === totalOtherMembers);
        let someBlocked = (blockedOtherMembers > 0 && blockedOtherMembers < totalOtherMembers);

        let messageElements = [];
        for (let i = 0; i < filteredMessages.length; i++) {
            let msg = filteredMessages[i];
            let isMine = false;
            if (msg.senderId === currentUser.uid) {
                isMine = true;
            }

            // Group chat filtering
            if (!isDirectMessage && !isMine) {
                let myBlocked = [];
                if (usersCache[currentUser.uid] && usersCache[currentUser.uid].blockedUsers) {
                    myBlocked = usersCache[currentUser.uid].blockedUsers;
                }
                let theirBlocked = [];
                if (usersCache[msg.senderId] && usersCache[msg.senderId].blockedUsers) {
                    theirBlocked = usersCache[msg.senderId].blockedUsers;
                }

                if (myBlocked.includes(msg.senderId) || theirBlocked.includes(currentUser.uid)) {
                    continue; // Hide messages mutually
                }
            }

            let senderInfo = usersCache[msg.senderId];
            if (!senderInfo) {
                senderInfo = {};
            }

            let messageWrapperClass = "message-wrapper";
            if (isMine) {
                messageWrapperClass = messageWrapperClass + " mine";
            } else {
                messageWrapperClass = messageWrapperClass + " others";
            }
            if (highlightMsgId === msg.id) {
                messageWrapperClass = messageWrapperClass + " message-highlight";
            }

            let avatarElement = null;
            if (!isMine) {
                if (senderInfo.profilePicture) {
                    avatarElement = <img src={senderInfo.profilePicture} alt="avatar" className="avatar" />;
                } else {
                    avatarElement = <div className="avatar"></div>;
                }
            }

            let senderNameElement = null;
            if (!isMine) {
                let senderName = senderInfo.username;
                if (!senderName) {
                    senderName = senderInfo.email;
                }
                senderNameElement = <span className="sender-name">{senderName}</span>;
            }

            let quotedMessageElement = null;
            if (msg.replyTo) {
                let quoteSenderName = "某人";
                if (usersCache[msg.replyTo.senderId]) {
                    if (usersCache[msg.replyTo.senderId].username) {
                        quoteSenderName = usersCache[msg.replyTo.senderId].username;
                    } else if (usersCache[msg.replyTo.senderId].email) {
                        quoteSenderName = usersCache[msg.replyTo.senderId].email;
                    }
                }

                let quoteContent = null;
                if (msg.replyTo.type === 'text') {
                    quoteContent = <span>{msg.replyTo.text}</span>;
                } else {
                    quoteContent = <span>[圖片]</span>;
                }

                quotedMessageElement = (
                    <div
                        className="quoted-message"
                        style={{ cursor: 'pointer' }}
                        onClick={function () { scrollToOriginalMessage(msg.replyTo.id); }}
                    >
                        <strong>{quoteSenderName}: </strong>
                        {quoteContent}
                    </div>
                );
            }

            let messageBubbleContent = null;
            if (msg.type === 'text') {
                messageBubbleContent = <p>{msg.text}</p>;
            } else {
                messageBubbleContent = <img src={msg.imageUrl} alt="chat-img" className="chat-image" />;
            }

            let messageActionsElement = null;
            let editButton = null;
            let deleteButton = null;
            let blockButton = null;

            if (isMine) {
                if (msg.type === 'text') {
                    editButton = <button onClick={function () { startEditing(msg); }}>編輯</button>;
                }
                deleteButton = <button onClick={function () { handleDeleteMessage(msg.id); }}>收回</button>;
            } else if (!isDirectMessage) {
                blockButton = <button onClick={function () { handleBlockUser(msg.senderId); }}>封鎖</button>;
            }

            let replyButton = <button onClick={function () { startReplying(msg); }}>回覆</button>;

            messageActionsElement = (
                <div className="message-actions">
                    {replyButton}
                    {editButton}
                    {deleteButton}
                    {blockButton}
                </div>
            );

            let editedTagElement = null;
            if (msg.isEdited) {
                editedTagElement = <span className="edited-tag">(已編輯)</span>;
            }

            messageElements.push(
                <div key={msg.id} id={"msg-" + msg.id} className={messageWrapperClass}>
                    {avatarElement}
                    <div className="message-content">
                        {senderNameElement}
                        <div className="message-bubble">
                            {quotedMessageElement}
                            {messageBubbleContent}
                        </div>
                        {messageActionsElement}
                        {editedTagElement}
                    </div>
                </div>
            );
        }

        let inputPlaceholder = editingMsgId ? "編輯訊息..." : "輸入訊息...";

        let submitButtonText = editingMsgId ? "儲存" : "發送";

        let submitDisabled = false;
        if (uploadingImage) {
            submitDisabled = true;
        } else {
            let hasText = false;
            if (inputText.trim() !== '') {
                hasText = true;
            }
            if (!hasText && !editingMsgId) {
                submitDisabled = true;
            }
        }

        let cancelEditButton = null;
        if (editingMsgId) {
            cancelEditButton = <button type="button" onClick={cancelEditing}>取消</button>;
        }

        let replyPreviewElement = null;
        if (replyToMsg) {
            let replyText = "";
            if (replyToMsg.type === 'text') {
                replyText = replyToMsg.text;
            } else {
                replyText = "[圖片]";
            }

            let replySenderName = "某人";
            if (usersCache[replyToMsg.senderId]) {
                if (usersCache[replyToMsg.senderId].username) {
                    replySenderName = usersCache[replyToMsg.senderId].username;
                } else if (usersCache[replyToMsg.senderId].email) {
                    replySenderName = usersCache[replyToMsg.senderId].email;
                }
            }

            replyPreviewElement = (
                <div className="reply-preview">
                    <span>回覆 {replySenderName}: {replyText}</span>
                    <button type="button" onClick={cancelReplying}>✕</button>
                </div>
            );
        }
        let inputContainerContent = null;
        if (allBlocked) {
            let unblockButtonElement = null;
            if (isDirectMessage && iBlockedThemCount === 1 && otherUserId) {
                unblockButtonElement = <button onClick={function () { handleUnblockUser(otherUserId); }} className="unblock-btn">解除封鎖</button>;
            }
            inputContainerContent = (
                <div className="blocked-warning-box">
                    <p>{isDirectMessage ? "你們無法再繼續聊天。" : "群組內所有成員皆已被封鎖，無法再傳送訊息。"}</p>
                    {unblockButtonElement}
                </div>
            );
        } else {
            let someBlockedWarning = null;
            if (someBlocked) {
                someBlockedWarning = (
                    <div className="some-blocked-warning" style={{ textAlign: 'center', padding: '5px', fontSize: '12px', color: '#856404', backgroundColor: '#fff3cd' }}>
                        部分成員已被封鎖，將互相隱藏訊息。
                    </div>
                );
            }
            inputContainerContent = (
                <>
                    {someBlockedWarning}
                    <form className="chat-input-area" onSubmit={handleSendMessage}>
                        <input
                            type="text"
                            value={inputText}
                            onChange={handleInputChange}
                            placeholder={inputPlaceholder}
                            disabled={uploadingImage}
                        />
                        <label className="upload-btn">
                            +
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleSendImage}
                                style={{ display: 'none' }}
                                disabled={uploadingImage}
                            />
                        </label>
                        <button type="submit" disabled={submitDisabled}>
                            {submitButtonText}
                        </button>
                        {cancelEditButton}
                    </form>
                </>
            );
        }

        mainChatContent = [
            <div key="header" className="chat-header">
                <h2>
                    <button className="back-btn" onClick={clearCurrentRoom}>⬅️</button>
                    {currentRoom.name}
                </h2>
                <div className="header-actions">
                    <input
                        type="text"
                        placeholder="搜尋訊息..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        className="search-input"
                    />
                    <button onClick={handleInviteMember}>邀請成員</button>
                    {isDirectMessage && !allBlocked ? (
                        <button onClick={function () { handleBlockUser(otherUserId); }} className="block-btn">封鎖此人</button>
                    ) : null}
                </div>
            </div>,

            <div key="list" className="message-list">
                {messageElements}
                <div ref={messagesEndRef}></div>
            </div>,

            <div key="input-container" className="input-container">
                {replyPreviewElement}
                {inputContainerContent}
            </div>
        ];
    } else {
        mainChatContent = (
            <div className="empty-state">
                <h2>請選擇或建立一個聊天室開始對話</h2>
            </div>
        );
    }

    return (
        <div className={chatLayoutClass}>
            <div className="sidebar">
                <div className="sidebar-header">
                    <h3>我的聊天室</h3>
                    <button onClick={handleCreateRoom} className="icon-btn">新增聊天室</button>
                </div>
                <div className="room-list">
                    {roomListElements}
                </div>
                <div className="sidebar-footer">
                    <button onClick={navigateToProfile} className="profile-btn">設定個人資料</button>
                    <button onClick={handleLogout} className="logout-btn">登出</button>
                </div>
            </div>

            <div className="main-chat">
                {mainChatContent}
            </div>
        </div>
    );
}
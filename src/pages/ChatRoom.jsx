import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
    getFirestore, collection, query, where, onSnapshot,
    addDoc, serverTimestamp, doc, updateDoc, deleteDoc, getDocs, arrayUnion
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useNavigate } from 'react-router-dom';
import app from '../firebase';
import './Chat.css';

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
    const messagesEndRef = useRef(null);

    useEffect(() => {
        const fetchUsers = async () => {
            const usersSnapshot = await getDocs(collection(db, "users"));
            const cache = {};
            usersSnapshot.forEach(doc => {
                cache[doc.id] = doc.data();
            });
            setUsersCache(cache);
        };
        fetchUsers();
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

    const handleCreateRoom = async () => {
        const roomName = prompt("請輸入新聊天室/群組名稱：");
        if (!roomName) return;
        await addDoc(collection(db, "rooms"), {
            name: roomName,
            members: [currentUser.uid],
            createdAt: serverTimestamp()
        });
    };

    const handleInviteMember = async () => {
        if (!currentRoom) return;
        const inviteEmail = prompt("請輸入欲邀請使用者的 Email：");
        if (!inviteEmail) return;

        const targetUser = Object.entries(usersCache).find(([uid, data]) => data.email === inviteEmail);
        if (targetUser) {
            await updateDoc(doc(db, "rooms", currentRoom.id), { members: arrayUnion(targetUser[0]) });
            alert("邀請成功！");
        } else {
            alert("找不到該使用者。");
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputText.trim() || !currentRoom) return;

        if (editingMsgId) {
            await updateDoc(doc(db, `rooms/${currentRoom.id}/messages`, editingMsgId), { text: inputText, isEdited: true });
            setEditingMsgId(null);
        } else {
            await addDoc(collection(db, `rooms/${currentRoom.id}/messages`), {
                text: inputText, senderId: currentUser.uid, timestamp: serverTimestamp(), type: 'text'
            });
        }
        setInputText('');
    };

    const handleSendImage = async (e) => {
        const file = e.target.files[0];
        if (!file || !currentRoom) return;
        setUploadingImage(true);
        try {
            const imageRef = ref(storage, `chat_images/${currentRoom.id}/${Date.now()}_${file.name}`);
            await uploadBytes(imageRef, file);
            await addDoc(collection(db, `rooms/${currentRoom.id}/messages`), {
                imageUrl: await getDownloadURL(imageRef), senderId: currentUser.uid, timestamp: serverTimestamp(), type: 'image'
            });
        } catch (error) {
            alert("圖片發送失敗：" + error.message);
        } finally {
            setUploadingImage(false);
        }
    };

    const handleDeleteMessage = async (msgId) => {
        if (window.confirm("確定要收回這則訊息嗎？")) {
            await deleteDoc(doc(db, `rooms/${currentRoom.id}/messages`, msgId));
        }
    };

    const startEditing = (msg) => {
        setEditingMsgId(msg.id);
        setInputText(msg.text);
    };

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    const filteredMessages = messages.filter(msg => 
        msg.type === 'text' && msg.text.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className={`chat-layout ${currentRoom ? 'room-active' : ''}`}>
            {/* 左側：聊天室列表 */}
            <div className="sidebar">
                <div className="sidebar-header">
                    <h3>我的聊天室</h3>
                    <button onClick={handleCreateRoom} className="icon-btn">➕ 新增</button>
                </div>
                <div className="room-list">
                    {rooms.map(room => (
                        <div
                            key={room.id}
                            className={`room-item ${currentRoom?.id === room.id ? 'active' : ''}`}
                            onClick={() => setCurrentRoom(room)}
                        >
                            {room.name || '未命名群組'}
                        </div>
                    ))}
                </div>
                <div className="sidebar-footer">
                    <button onClick={() => navigate('/profile')} className="profile-btn">設定個人資料</button>
                    <button onClick={handleLogout} className="logout-btn">登出</button>
                </div>
            </div>

            {/* 右側：主聊天區域 */}
            <div className="main-chat">
                {currentRoom ? (
                    <>
                        <div className="chat-header">
                            <h2>
                                <button className="back-btn" onClick={() => setCurrentRoom(null)}>⬅️</button>
                                {currentRoom.name}
                            </h2>
                            <div className="header-actions">
                                <input
                                    type="text"
                                    placeholder="搜尋訊息..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="search-input"
                                />
                                <button onClick={handleInviteMember}>邀請成員</button>
                            </div>
                        </div>

                        <div className="message-list">
                            {filteredMessages.map(msg => {
                                const isMine = msg.senderId === currentUser.uid;
                                const senderInfo = usersCache[msg.senderId] || {};
                                return (
                                    <div key={msg.id} className={`message-wrapper ${isMine ? 'mine' : 'others'}`}>
                                        {!isMine && (
                                            senderInfo.profilePicture ? (
                                                <img src={senderInfo.profilePicture} alt="avatar" className="avatar" />
                                            ) : (
                                                <div className="avatar" />
                                            )
                                        )}
                                        <div className="message-content">
                                            {!isMine && <span className="sender-name">{senderInfo.username || senderInfo.email}</span>}
                                            <div className="message-bubble">
                                                {msg.type === 'text' ? (
                                                    <p>{msg.text}</p>
                                                ) : (
                                                    <img src={msg.imageUrl} alt="chat-img" className="chat-image" />
                                                )}
                                            </div>
                                            {isMine && (
                                                <div className="message-actions">
                                                    {msg.type === 'text' && (
                                                        <button onClick={() => startEditing(msg)}>編輯</button>
                                                    )}
                                                    <button onClick={() => handleDeleteMessage(msg.id)}>收回</button>
                                                </div>
                                            )}
                                            {msg.isEdited && <span className="edited-tag">(已編輯)</span>}
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        <form className="chat-input-area" onSubmit={handleSendMessage}>
                            <input
                                type="text"
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                placeholder={editingMsgId ? "編輯訊息..." : "輸入訊息..."}
                                disabled={uploadingImage}
                            />
                            <label className="upload-btn">
                                📷
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    onChange={handleSendImage} 
                                    style={{ display: 'none' }} 
                                    disabled={uploadingImage} 
                                />
                            </label>
                            <button type="submit" disabled={uploadingImage || (!inputText.trim() && !editingMsgId)}>
                                {editingMsgId ? '儲存' : '發送'}
                            </button>
                            {editingMsgId && (
                                <button type="button" onClick={() => { setEditingMsgId(null); setInputText(''); }}>取消</button>
                            )}
                        </form>
                    </>
                ) : (
                    <div className="empty-state">
                        <h2>請選擇或建立一個聊天室開始對話</h2>
                    </div>
                )}
            </div>
        </div>
    );
}
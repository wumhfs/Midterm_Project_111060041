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

    // ================= 初始化與資料監聽 =================

    // 1. 取得所有使用者資料 (用於顯示名稱與頭像)
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

    // 2. 監聽目前使用者所屬的聊天室 (Basic: Load chatrooms)
    useEffect(() => {
        if (!currentUser) return;
        const q = query(collection(db, "rooms"), where("members", "array-contains", currentUser.uid));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const roomData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRooms(roomData);
        });
        return () => unsubscribe();
    }, [currentUser, db]);

    // 3. 監聽當前聊天室的訊息 (Basic: Load history message)
    useEffect(() => {
        if (!currentRoom) return;
        const q = query(collection(db, `rooms/${currentRoom.id}/messages`));
        // 注意：為了簡化，這裡在前端用 JS 排序。若資料量大，應在 Firestore 建立索引並用 orderBy
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // 依時間排序
            msgData.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
            setMessages(msgData);
            scrollToBottom();
        });
        return () => unsubscribe();
    }, [currentRoom, db]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // ================= 通知功能 (Adv: Chrome Notifications) =================
    const currentRoomIdRef = useRef(null);
    const usersCacheRef = useRef({});
    const notifiedMsgsRef = useRef(new Set());

    useEffect(() => {
        currentRoomIdRef.current = currentRoom?.id;
    }, [currentRoom]);

    useEffect(() => {
        usersCacheRef.current = usersCache;
    }, [usersCache]);

    // 要求通知權限
    useEffect(() => {
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    // 監聽所有聊天室以發送未讀訊息通知
    useEffect(() => {
        if (!currentUser || rooms.length === 0) return;

        const unsubscribes = rooms.map(room => {
            const q = query(collection(db, `rooms/${room.id}/messages`));
            return onSnapshot(q, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added") {
                        const msg = change.doc.data();
                        const msgId = change.doc.id;
                        
                        // 略過自己發送的訊息
                        if (msg.senderId === currentUser.uid) return;
                        
                        // 略過已經通知過的訊息 (避免重複)
                        if (notifiedMsgsRef.current.has(msgId)) return;
                        notifiedMsgsRef.current.add(msgId);

                        // 判斷是否為「未讀」狀態：
                        // 1. 不是目前正在瀏覽的聊天室
                        // 2. 或是目前正在瀏覽，但瀏覽器處於隱藏狀態 (切到其他分頁或縮小)
                        const isNotCurrentRoom = currentRoomIdRef.current !== room.id;
                        const isHidden = document.hidden;

                        if (isNotCurrentRoom || isHidden) {
                            const now = Date.now();
                            // 若無 timestamp(剛發出)，預設為最新；若有，則檢查是否為 10 秒內的訊息，避免初次載入舊訊息狂跳通知
                            const msgTime = msg.timestamp ? msg.timestamp.toMillis() : now;
                            if (now - msgTime < 10000) {
                                if ("Notification" in window && Notification.permission === "granted") {
                                    const senderInfo = usersCacheRef.current[msg.senderId] || {};
                                    const senderName = senderInfo.username || senderInfo.email || "某人";
                                    const text = msg.type === 'text' ? msg.text : '[圖片]';
                                    
                                    new Notification(`來自 ${room.name} 的新訊息`, {
                                        body: `${senderName}: ${text}`,
                                        icon: senderInfo.profilePicture || 'https://via.placeholder.com/40'
                                    });
                                }
                            }
                        }
                    }
                });
            });
        });

        return () => unsubscribes.forEach(unsub => unsub());
    }, [currentUser, rooms, db]);

    // ================= 核心操作邏輯 =================

    // 建立新聊天室 (Basic: Create private chatrooms)
    const handleCreateRoom = async () => {
        const roomName = prompt("請輸入新聊天室/群組名稱：");
        if (!roomName) return;
        await addDoc(collection(db, "rooms"), {
            name: roomName,
            members: [currentUser.uid],
            createdAt: serverTimestamp()
        });
    };

    // 邀請成員加入當前聊天室 (Basic: Invite new members)
    const handleInviteMember = async () => {
        if (!currentRoom) return;
        // 實務上應實作選單，此處以輸入對方 Email 尋找 UID 示意
        const inviteEmail = prompt("請輸入欲邀請使用者的 Email：");
        if (!inviteEmail) return;

        // 尋找該 Email 對應的 UID
        const targetUser = Object.entries(usersCache).find(([uid, data]) => data.email === inviteEmail);
        if (targetUser) {
            const roomRef = doc(db, "rooms", currentRoom.id);
            await updateDoc(roomRef, {
                members: arrayUnion(targetUser[0])
            });
            alert("邀請成功！");
        } else {
            alert("找不到該使用者，請確認 Email 是否正確且已註冊。");
        }
    };

    // 發送文字訊息 (Basic: Chat with members / Adv: XSS prevention via React)
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputText.trim() || !currentRoom) return;

        if (editingMsgId) {
            // Adv: Edit message
            await updateDoc(doc(db, `rooms/${currentRoom.id}/messages`, editingMsgId), {
                text: inputText,
                isEdited: true
            });
            setEditingMsgId(null);
        } else {
            // 新增訊息
            await addDoc(collection(db, `rooms/${currentRoom.id}/messages`), {
                text: inputText,
                senderId: currentUser.uid,
                timestamp: serverTimestamp(),
                type: 'text'
            });
        }
        setInputText('');
    };

    // 發送圖片 (Adv: Send Images)
    const handleSendImage = async (e) => {
        const file = e.target.files[0];
        if (!file || !currentRoom) return;
        setUploadingImage(true);
        try {
            const imageRef = ref(storage, `chat_images/${currentRoom.id}/${Date.now()}_${file.name}`);
            await uploadBytes(imageRef, file);
            const imageUrl = await getDownloadURL(imageRef);

            await addDoc(collection(db, `rooms/${currentRoom.id}/messages`), {
                imageUrl: imageUrl,
                senderId: currentUser.uid,
                timestamp: serverTimestamp(),
                type: 'image'
            });
        } catch (error) {
            alert("圖片發送失敗：" + error.message);
        } finally {
            setUploadingImage(false);
        }
    };

    // 收回訊息 (Adv: Unsend message)
    const handleDeleteMessage = async (msgId) => {
        if (window.confirm("確定要收回這則訊息嗎？")) {
            await deleteDoc(doc(db, `rooms/${currentRoom.id}/messages`, msgId));
        }
    };

    // 啟動編輯模式
    const startEditing = (msg) => {
        setEditingMsgId(msg.id);
        setInputText(msg.text);
    };

    // 執行登出
    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    // ================= 畫面渲染 =================

    // 搜尋過濾邏輯 (Adv: Search messages)
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
                                        {/* Adv: 顯示發送者頭像與名稱 */}
                                        {!isMine && (
                                            <img
                                                src={senderInfo.profilePicture || 'https://via.placeholder.com/40'}
                                                alt="avatar"
                                                className="avatar"
                                            />
                                        )}
                                        <div className="message-content">
                                            {!isMine && <span className="sender-name">{senderInfo.username || senderInfo.email}</span>}

                                            <div className="message-bubble">
                                                {msg.type === 'text' ? (
                                                    <p>{msg.text}</p> // React 預設會防範 XSS
                                                ) : (
                                                    <img src={msg.imageUrl} alt="chat-img" className="chat-image" />
                                                )}
                                            </div>

                                            {/* Adv: 編輯與收回按鈕 (僅限自己的訊息) */}
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
                            {/* 隱藏的檔案上傳按鈕，用 label 包裝 */}
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
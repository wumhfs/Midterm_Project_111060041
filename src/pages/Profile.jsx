import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import app from '../firebase';
import './Profile.css';

export default function Profile() {
    const { currentUser } = useAuth();
    const db = getFirestore(app);
    const storage = getStorage(app);

    const [userData, setUserData] = useState({
        username: '',
        email: '',
        phoneNumber: '',
        address: '',
        profilePicture: ''
    });

    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        const fetchUserData = async () => {
            if (currentUser) {
                const docSnap = await getDoc(doc(db, "users", currentUser.uid));
                if (docSnap.exists()) setUserData(docSnap.data());
            }
        };
        fetchUserData();
    }, [currentUser, db]);
    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        try {
            const storageRef = ref(storage, `profiles/${currentUser.uid}`);
            await uploadBytes(storageRef, file);
            const photoURL = await getDownloadURL(storageRef);

            // 更新本地預覽
            setUserData(prev => ({ ...prev, profilePicture: photoURL }));
            setMessage('照片上傳成功，請記得點擊儲存變更。');
        } catch (error) {
            setMessage('圖片上傳失敗：' + error.message);
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setMessage('儲存中...');

        try {
            await updateDoc(doc(db, "users", currentUser.uid), {
                username: userData.username,
                email: userData.email,
                phoneNumber: userData.phoneNumber,
                address: userData.address,
                profilePicture: userData.profilePicture
            });
            setMessage('個人資料已成功更新！');
        } catch (error) {
            setMessage('儲存失敗：' + error.message);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setUserData(prev => ({ ...prev, [name]: value }));
    };

    return (
        <div className="profile-page-container">
            <div className="profile-card">
                <h1 className="profile-title">個人資料設定</h1>
                {message && <p className="profile-message">{message}</p>}

                <form onSubmit={handleSave} className="profile-form">
                    <div className="profile-field">
                        <label>大頭貼：</label>
                        <div className="profile-picture-container">
                            {userData.profilePicture && (
                                <img src={userData.profilePicture} alt="Profile" className="profile-image-preview" />
                            )}
                            <input type="file" accept="image/*" onChange={handleImageChange} disabled={uploading} className="profile-file-input" />
                        </div>
                    </div>
                    <div className="profile-field">
                        <label>使用者名稱：</label>
                        <input type="text" name="username" value={userData.username} onChange={handleChange} />
                    </div>
                    <div className="profile-field">
                        <label>Email：</label>
                        <input type="email" name="email" value={userData.email} onChange={handleChange} />
                    </div>
                    <div className="profile-field">
                        <label>電話號碼：</label>
                        <input type="tel" name="phoneNumber" value={userData.phoneNumber} onChange={handleChange} />
                    </div>
                    <div className="profile-field">
                        <label>地址：</label>
                        <textarea name="address" value={userData.address} onChange={handleChange} />
                    </div>

                    <button type="submit" disabled={uploading} className="profile-save-btn">
                        儲存變更
                    </button>
                </form>
            </div>
        </div>
    );
}
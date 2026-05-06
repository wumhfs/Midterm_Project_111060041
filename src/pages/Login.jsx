import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider
} from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore'; // 新增 Firestore 函式
import app from '../firebase';
import './Login.css';

export default function Login() {
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    const navigate = useNavigate();
    const auth = getAuth(app);
    const db = getFirestore(app); // 初始化 Firestore

    // 處理 Email 登入或註冊
    const handleEmailAuth = async (e) => {
        e.preventDefault();
        setErrorMsg('');

        try {
            if (isRegisterMode) {
                // 執行註冊
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // 註冊成功後，依規範建立使用者的初始個人資料
                await setDoc(doc(db, "users", user.uid), {
                    email: user.email,
                    username: user.email.split('@')[0], // 預設使用 Email 前綴作為名稱
                    profilePicture: "",
                    phoneNumber: "",
                    address: ""
                });
            } else {
                // 執行登入
                await signInWithEmailAndPassword(auth, email, password);
            }
            navigate('/chat');
        } catch (error) {
            setErrorMsg(error.message);
        }
    };

    // 處理 Google 登入
    const handleGoogleLogin = async () => {
        setErrorMsg('');
        const provider = new GoogleAuthProvider();

        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // 檢查該 Google 帳號是否為初次登入
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            // 如果在資料庫中找不到該使用者，代表是初次登入，依規範建立初始資料
            if (!userDoc.exists()) {
                await setDoc(userDocRef, {
                    email: user.email,
                    username: user.displayName || user.email.split('@')[0],
                    profilePicture: user.photoURL || "",
                    phoneNumber: "",
                    address: ""
                });
            }
            navigate('/chat');
        } catch (error) {
            setErrorMsg(error.message);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <h2 className="login-title">{isRegisterMode ? '建立新帳號' : '登入聊天室'}</h2>

                {errorMsg && <div className="error-message">{errorMsg}</div>}

                <form className="login-form" onSubmit={handleEmailAuth}>
                    <div className="input-group">
                        <input
                            type="email"
                            className="login-input"
                            placeholder="請輸入 Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="input-group">
                        <input
                            type="password"
                            className="login-input"
                            placeholder="請輸入密碼"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="login-button primary-btn">
                        {isRegisterMode ? '註冊' : '登入'}
                    </button>
                </form>

                <div className="divider">
                    <span>或</span>
                </div>

                <button type="button" onClick={handleGoogleLogin} className="login-button google-btn">
                    使用 Google 帳號登入
                </button>

                <button
                    type="button"
                    onClick={() => setIsRegisterMode(!isRegisterMode)}
                    className="toggle-mode-btn"
                >
                    {isRegisterMode ? '已經有帳號了？點此登入' : '還沒有帳號？點此註冊'}
                </button>
            </div>
        </div>
    );
}
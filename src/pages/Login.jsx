import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider
} from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import app from '../firebase';
import './Login.css';

export default function Login() {
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    const navigate = useNavigate();
    const auth = getAuth(app);
    const db = getFirestore(app);

    async function handleEmailAuth(e) {
        e.preventDefault();
        setErrorMsg('');

        try {
            if (isRegisterMode) {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                await setDoc(doc(db, "users", user.uid), {
                    email: user.email,
                    username: user.email.split('@')[0],
                    profilePicture: "",
                    phoneNumber: "",
                    address: ""
                });
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            navigate('/chat');
        } catch (error) {
            setErrorMsg(error.message);
        }
    }

    // 處理 Google 登入
    async function handleGoogleLogin() {
        setErrorMsg('');
        const provider = new GoogleAuthProvider();

        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

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
    }

    function handleEmailChange(e) {
        setEmail(e.target.value);
    }

    function handlePasswordChange(e) {
        setPassword(e.target.value);
    }

    function toggleMode() {
        setIsRegisterMode(!isRegisterMode);
    }

    let titleText = '登入聊天室';
    let submitButtonText = '登入';
    let toggleButtonText = '還沒有帳號？點此註冊';

    if (isRegisterMode) {
        titleText = '建立新帳號';
        submitButtonText = '註冊';
        toggleButtonText = '已經有帳號了？點此登入';
    }

    let errorElement = null;
    if (errorMsg) {
        errorElement = <div className="error-message">{errorMsg}</div>;
    }

    return (
        <div className="login-container">
            <div className="login-card">
                <h2 className="login-title">{titleText}</h2>

                {errorElement}

                <form className="login-form" onSubmit={handleEmailAuth}>
                    <input
                        type="email"
                        className="login-input"
                        placeholder="請輸入 Email"
                        value={email}
                        onChange={handleEmailChange}
                        required
                    />
                    <input
                        type="password"
                        className="login-input"
                        placeholder="請輸入密碼"
                        value={password}
                        onChange={handlePasswordChange}
                        required
                    />
                    <button type="submit" className="login-button primary-btn">
                        {submitButtonText}
                    </button>
                </form>

                <div className="divider">或</div>

                <button type="button" onClick={handleGoogleLogin} className="login-button google-btn">
                    使用 Google 帳號登入
                </button>

                <button
                    type="button"
                    onClick={toggleMode}
                    className="toggle-mode-btn"
                >
                    {toggleButtonText}
                </button>
            </div>
        </div>
    );
}
import { createContext, useContext, useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import app from '../firebase';

const AuthContext = createContext();

// 自訂一個 Hook，讓其他元件可以輕鬆呼叫
export function useAuth() {
    return useContext(AuthContext);
}

// 2. 建立 Provider 元件
export function AuthProvider({ children }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true); // 預設為正在載入
    const auth = getAuth(app);

    useEffect(() => {
        // 啟動 Firebase 監聽器
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setCurrentUser(user);
            setLoading(false); // 收到 Firebase 回應了，解除載入狀態
        });

        // 元件卸載時清除監聽器，避免記憶體流失
        return unsubscribe;
    }, []);

    // 準備要廣播出去的資料
    const logout = () => {
        return signOut(auth);
    };

    const value = {
        currentUser,
        logout
    };

    // 3. 只要還在 loading，就不渲染內部的畫面 (children)
    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
}
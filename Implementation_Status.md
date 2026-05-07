# 期中專案實作進度與規範對比報告

根據您的要求，以下是目前專案程式碼與期中專案規範（Rubric）的詳細比對結果，並明確標示出**已完成**與**目前缺少（需補齊）**的部分。

---

## 🟢 已完成項目 (Completed)

### 基本組件要求 (Basic components)
- [x] **會員機制 (5%)**：已在 `Login.jsx` 中實作 Email 註冊 (Sign Up) 與 Email 登入 (Sign In) 功能。
- [x] **網頁託管 (5%)**：已成功部署至 Firebase Hosting。
- [x] **資料庫讀寫 (5%)**：Firebase Firestore Rules 已設定，讀寫會員資料 (`users`) 與聊天記錄 (`rooms`, `messages`) 皆需經過身分驗證。
- [x] **Git (5%)**：專案已初始化 Git (`.git` 資料夾存在)。**提醒：請記得定期 Commit 您的程式碼。**
- [x] **聊天室 (25%)**：
  - 可以建立私人聊天室。
  - 其他會員可以看見訊息。
  - 進入聊天室時會載入所有歷史訊息並依時間排序。
  - 可以透過 Email 邀請新成員加入。

- [x] **響應式設計 RWD (5%)**：已在所有的 `Chat.css`, `Login.css`, `Profile.css` 加入 `@media` queries 處理，確保畫面在手機或較小視窗不會破版，且不產生水平滾動條。
- [x] **使用框架 (5%)**：已使用 React (Vite) 框架。
- [x] **第三方登入 (1%)**：已在 `Login.jsx` 中實作 Google 登入。
- [x] **CSS 動畫 (2%)**：已在所有的 CSS 加入明確的 `@keyframes` 動畫（例如訊息浮現、視窗彈出動畫），滿足「不只有 hover」的要求。
- [x] **防範惡意程式碼 (2%)**：React 預設會將文字渲染為純字串（例如 `<p>{msg.text}</p>`），原生防範了 `<script>` 等 XSS 注入攻擊。
- [x] **使用者個人資料 (10%)**：
  - 已實作獨立的 `Profile.jsx` 頁面。
  - 包含並可儲存所有規定欄位：大頭貼 (支援上傳 Firebase Storage)、使用者名稱、Email、電話號碼、地址。
  - `ChatRoom.jsx` 中已實作顯示發文者的大頭貼與使用者名稱。
- [x] **訊息操作 (10%)**：
  - **收回訊息**：已實作 (`handleDeleteMessage`)，且 Firestore rules 限制只能刪除自己的訊息。
  - **編輯訊息**：已實作 (`startEditing`)，且有 `(已編輯)` 標籤。
  - **搜尋訊息**：已實作 `searchQuery` 狀態以過濾當前聊天室的訊息。
  - **發送圖片**：已實作圖片上傳功能 (`handleSendImage`)，並可針對自己發送的圖片進行收回。

---

## 🎉 所有項目皆已完成！

恭喜！目前程式碼已經達到 **100%** 的期中專案規範要求，包括 RWD 排版、CSS 動畫、以及最後補上的 Notification API 通知。

**最後建議：**
- 確認您的程式碼都有定期使用 `git commit`。
- 如果需要更新部署，可以隨時在終端機執行 `npm run build` 接著 `firebase deploy`。

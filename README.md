# Bookmark Vault

個人化書籤網站，支援 Firebase Email/Password 登入、註冊、Firestore 同步，以及 GitHub Pages 部署。

## 本地開發

```bash
npm install
npm run dev
```

## 環境變數

請新增 `.env`，內容參考 `.env.example`：

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 部署前檢查

1. Firebase Console 開啟 Email/Password 登入。
2. Firestore 建立資料庫。
3. 匯入 `firestore.rules`。
4. GitHub Pages 啟用 Actions 部署。
5. GitHub Pages 專案路徑固定為 `/bookmark/`，對應 repo `bookmark`。

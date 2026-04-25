# 冥夜書籤小站

一個以 Firebase 為後端的個人書籤管理網站，支援帳密登入、跨裝置同步、模式化分類、分類改名與刪除、GitHub Pages 自動部署。

## 主要功能

- Firebase Email/Password 註冊與登入
- Firestore 即時同步書籤資料
- 自動擷取網站描述與網站圖示（metadata）
- 三種模式切換：娛樂 / 上課 / coding（預設為娛樂）
- 可編輯「分類對應模式」並儲存在瀏覽器 `localStorage`
- 書籤分類可改名、可移動到其他模式、可刪除（刪除時移到未分類）
- 右側新增書籤卡片支援黏性釘選（桌面版）

## 技術堆疊

- Vite + React + TypeScript
- Firebase Authentication
- Cloud Firestore
- GitHub Actions + GitHub Pages

## 本地開發

```bash
npm install
npm run dev
```

## 環境變數

請在專案根目錄建立 `.env`：

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 建置與檢查

```bash
npm run build
```

## 部署（GitHub Pages）

本專案使用 `.github/workflows/deploy.yml` 自動部署到 GitHub Pages。

### 1) Repository Variables

到 GitHub 專案設定：`Settings -> Variables -> Actions`，建立以下變數：

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

### 2) Firebase 必要設定

1. 開啟 `Authentication -> Sign-in method -> Email/Password`
2. 建立 Firestore 資料庫
3. 部署 `firestore.rules`
4. `Authentication -> Settings -> Authorized domains` 加入：
   - `localhost`
   - `brianlien09.github.io`

### 3) GitHub Pages 設定

- `Settings -> Pages -> Build and deployment`
- Source 請選擇 `GitHub Actions`

## 專案結構（重點）

- `src/App.tsx`：主要 UI 與書籤/分類/模式邏輯
- `src/firebase.ts`：Firebase 初始化與設定檢查
- `src/styles.css`：主要視覺樣式
- `firestore.rules`：Firestore 權限規則
- `.github/workflows/deploy.yml`：GitHub Pages 部署流程

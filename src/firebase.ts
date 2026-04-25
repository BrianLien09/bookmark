import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

type FirebaseEnv = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

const firebaseConfig: FirebaseEnv = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 檢查 Firebase 各環境變數的設定狀態
export function getFirebaseConfigStatus() {
  return {
    apiKey: Boolean(firebaseConfig.apiKey),
    authDomain: Boolean(firebaseConfig.authDomain),
    projectId: Boolean(firebaseConfig.projectId),
    storageBucket: Boolean(firebaseConfig.storageBucket),
    messagingSenderId: Boolean(firebaseConfig.messagingSenderId),
    appId: Boolean(firebaseConfig.appId),
  };
}

// 遮蔽敏感字串，只顯示開頭和結尾
function maskSensitiveValue(value: string): string {
  if (!value || value.length <= 8) {
    return '***';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

// 取得環境變數的詳細資訊（包括狀態和遮蔽後的值）
export function getFirebaseConfigDetails() {
  const envVarNames: Record<string, string> = {
    apiKey: 'VITE_FIREBASE_API_KEY',
    authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
    projectId: 'VITE_FIREBASE_PROJECT_ID',
    storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
    messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
    appId: 'VITE_FIREBASE_APP_ID',
  };

  // 在開發環境顯示完整值，便於診斷；生產環境隱藏敏感資訊
  const isDevelopment = import.meta.env.DEV;

  return Object.entries(firebaseConfig).map(([key, value]) => ({
    name: envVarNames[key as keyof typeof envVarNames],
    isSet: Boolean(value),
    displayValue: value 
      ? (isDevelopment ? value : maskSensitiveValue(value))
      : '(未設定)',
  }));
}

// 取得缺失的環境變數名稱清單（若有的話）
export function getFirebaseConfigErrors(): string[] {
  const status = getFirebaseConfigStatus();
  const envVarNames: Record<string, string> = {
    apiKey: 'VITE_FIREBASE_API_KEY',
    authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
    projectId: 'VITE_FIREBASE_PROJECT_ID',
    storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
    messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
    appId: 'VITE_FIREBASE_APP_ID',
  };

  return Object.entries(status)
    .filter(([_, isSet]) => !isSet)
    .map(([key]) => envVarNames[key as keyof typeof envVarNames]);
}

export const firebaseReady = getFirebaseConfigErrors().length === 0;

const app = firebaseReady ? initializeApp(firebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

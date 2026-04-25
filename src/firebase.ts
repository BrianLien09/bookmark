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

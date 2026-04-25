import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { auth, db, firebaseReady, getFirebaseConfigErrors } from './firebase';
import type { AuthMode, Bookmark, BookmarkFormState, BookmarkMode } from './types';

const emptyForm: BookmarkFormState = {
  title: '',
  url: '',
  category: '',
  notes: '',
  folderColor: '#2563eb',
};

const categoryColorPool = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

function pickRandomFolderColor(): string {
  return categoryColorPool[Math.floor(Math.random() * categoryColorPool.length)];
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function pickFolderColorForCategory(category: string, usedColors: Set<string>): string {
  for (const color of categoryColorPool) {
    if (!usedColors.has(color)) {
      return color;
    }
  }

  const baseHash = hashString(category);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const hue = (baseHash + attempt * 37) % 360;
    const color = `hsl(${hue} 75% 55%)`;
    if (!usedColors.has(color)) {
      return color;
    }
  }

  return `hsl(${baseHash % 360} 75% 55%)`;
}

function normalizeUrl(value: string): string {
  if (!value.trim()) {
    return '';
  }

  try {
    return new URL(value).toString();
  } catch {
    return new URL(`https://${value}`).toString();
  }
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

function formatFirestoreError(error: unknown): string {
  if (!(error instanceof Error)) {
    return '儲存失敗。';
  }

  const message = error.message.toLowerCase();
  if (message.includes('missing or insufficient permissions')) {
    return 'Firestore 權限不足。請確認 Firebase Console 已部署最新的 `firestore.rules`，而且登入帳號與資料的 `ownerUid` 相符。';
  }

  return error.message;
}

type SiteMetadata = {
  siteDescription: string;
  faviconUrl: string;
};

type MicrolinkResponse = {
  status?: string;
  data?: {
    description?: string;
    logo?: {
      url?: string;
    };
    image?: {
      url?: string;
    };
  };
};

type ModeOption = {
  key: BookmarkMode;
  label: string;
  icon: string;
};

const modeOptions: ModeOption[] = [
  {
    key: 'entertainment',
    label: '娛樂',
    icon: '🎬',
  },
  {
    key: 'study',
    label: '上課',
    icon: '📚',
  },
  {
    key: 'coding',
    label: 'coding',
    icon: '💻',
  },
];

type ModeCategoryMap = Record<BookmarkMode, string[]>;

const modeCategoriesStorageKey = 'bookmark-mode-categories-v1';

const defaultModeCategoryMap: ModeCategoryMap = {
  entertainment: ['影片', '音樂', '社群', '遊戲', '新聞', '生活'],
  study: ['課程平台', '作業', '講義', '參考資料', '測驗', '學習工具'],
  coding: ['文件', '套件', '範例', '部署', '除錯', '工具'],
};

function normalizeCategories(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }
    const dedupeKey = nextValue.toLowerCase();
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    normalized.push(nextValue);
  });

  return normalized;
}

function parseCategoryInput(value: string): string[] {
  return normalizeCategories(value.split(/[\n,，]/g));
}

function buildModeCategoryDraft(map: ModeCategoryMap): Record<BookmarkMode, string> {
  return {
    entertainment: map.entertainment.join('\n'),
    study: map.study.join('\n'),
    coding: map.coding.join('\n'),
  };
}

function loadModeCategoryMap(): ModeCategoryMap {
  if (typeof window === 'undefined') {
    return defaultModeCategoryMap;
  }

  try {
    const raw = window.localStorage.getItem(modeCategoriesStorageKey);
    if (!raw) {
      return defaultModeCategoryMap;
    }
    const parsed = JSON.parse(raw) as Partial<ModeCategoryMap>;

    return {
      entertainment: normalizeCategories(parsed.entertainment ?? defaultModeCategoryMap.entertainment),
      study: normalizeCategories(parsed.study ?? defaultModeCategoryMap.study),
      coding: normalizeCategories(parsed.coding ?? defaultModeCategoryMap.coding),
    };
  } catch {
    return defaultModeCategoryMap;
  }
}

const modeCategoryKeywords: Record<BookmarkMode, string[]> = {
  entertainment: ['影片', '音樂', '社群', '遊戲', '娛樂', 'news', 'movie', 'music'],
  study: ['課程', '學習', '作業', '講義', '教學', '學校', 'study', 'class'],
  coding: ['程式', 'coding', 'code', 'dev', 'api', 'github', 'deploy', '文件'],
};

function inferModeFromCategory(category: string, modeCategoryMap: ModeCategoryMap): BookmarkMode {
  const value = category.toLowerCase();

  for (const modeKey of ['entertainment', 'study', 'coding'] as BookmarkMode[]) {
    if (modeCategoryMap[modeKey].some((item) => item.toLowerCase() === value.trim())) {
      return modeKey;
    }
  }

  const modeOrder: BookmarkMode[] = ['coding', 'study', 'entertainment'];

  for (const modeKey of modeOrder) {
    if (modeCategoryKeywords[modeKey].some((keyword) => value.includes(keyword.toLowerCase()))) {
      return modeKey;
    }
  }

  return 'entertainment';
}

function findModeByExactCategory(category: string, modeCategoryMap: ModeCategoryMap): BookmarkMode | null {
  const normalizedCategory = category.trim().toLowerCase();
  if (!normalizedCategory) {
    return null;
  }

  for (const modeKey of ['entertainment', 'study', 'coding'] as BookmarkMode[]) {
    if (modeCategoryMap[modeKey].some((item) => item.toLowerCase() === normalizedCategory)) {
      return modeKey;
    }
  }

  return null;
}

function resolveBookmarkMode(bookmark: Bookmark, modeCategoryMap: ModeCategoryMap): BookmarkMode {
  // 以分類對應為最高優先，確保使用者手動指定的分類模式能即時反映到畫面
  const mappedMode = findModeByExactCategory(bookmark.category, modeCategoryMap);
  if (mappedMode) {
    return mappedMode;
  }

  if (bookmark.bookmarkMode) {
    return bookmark.bookmarkMode;
  }
  return inferModeFromCategory(bookmark.category, modeCategoryMap);
}

function buildDefaultDescription(url: URL): string {
  // 為了避免第三方 metadata 服務失敗時畫面空白，保留可讀的預設描述
  return `${url.hostname} 的網站連結`;
}

function buildDefaultFavicon(url: URL): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
}

async function fetchSiteMetadata(urlValue: string): Promise<SiteMetadata> {
  const parsedUrl = new URL(urlValue);
  const fallbackDescription = buildDefaultDescription(parsedUrl);
  const fallbackFavicon = buildDefaultFavicon(parsedUrl);

  try {
    const response = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(urlValue)}&screenshot=false&meta=false&palette=false`);
    if (!response.ok) {
      return {
        siteDescription: fallbackDescription,
        faviconUrl: fallbackFavicon,
      };
    }

    const payload = (await response.json()) as MicrolinkResponse;
    const description = payload.data?.description?.trim() || fallbackDescription;
    const iconCandidate = payload.data?.logo?.url || payload.data?.image?.url || fallbackFavicon;

    return {
      siteDescription: description,
      faviconUrl: iconCandidate,
    };
  } catch {
    return {
      siteDescription: fallbackDescription,
      faviconUrl: fallbackFavicon,
    };
  }
}

function getBookmarkHostname(urlValue: string): string {
  try {
    return new URL(urlValue).hostname.replace(/^www\./, '');
  } catch {
    return '未知網域';
  }
}

function getBookmarkDescription(bookmark: Bookmark): string {
  const existingDescription = bookmark.siteDescription?.trim();
  if (existingDescription) {
    return existingDescription;
  }

  try {
    return buildDefaultDescription(new URL(bookmark.url));
  } catch {
    return '網站連結';
  }
}

function getBookmarkFavicon(bookmark: Bookmark): string {
  const existingFavicon = bookmark.faviconUrl?.trim();
  if (existingFavicon) {
    return existingFavicon;
  }

  try {
    return buildDefaultFavicon(new URL(bookmark.url));
  } catch {
    return 'https://www.google.com/s2/favicons?domain=example.com&sz=64';
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkMode, setBookmarkMode] = useState<BookmarkMode>('entertainment');
  const [modeCategoryMap, setModeCategoryMap] = useState<ModeCategoryMap>(loadModeCategoryMap);
  const [editingModeCategories, setEditingModeCategories] = useState(false);
  const [modeCategoryDraft, setModeCategoryDraft] = useState<Record<BookmarkMode, string>>(() => buildModeCategoryDraft(loadModeCategoryMap()));
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(null);
  const [categoryRenameDraft, setCategoryRenameDraft] = useState('');
  const [categoryTargetMode, setCategoryTargetMode] = useState<BookmarkMode>('entertainment');
  const [renamingCategory, setRenamingCategory] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categorySelection, setCategorySelection] = useState('__new__');
  const [customCategory, setCustomCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BookmarkFormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const draftCategoryNameRef = useRef('');
  const draftCategoryColorRef = useRef('');

  useEffect(() => {
    if (!auth) {
      setUser(null);
      setLoading(false);
      return undefined;
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setBookmarks([]);
      return;
    }

    const q = query(collection(db, 'bookmarks'), where('ownerUid', '==', user.uid));
    return onSnapshot(q, (snapshot) => {
      const nextBookmarks = snapshot.docs
        .map((entry) => ({ id: entry.id, ...(entry.data() as Omit<Bookmark, 'id'>) }))
        .sort((left, right) => right.updatedAt - left.updatedAt);

      setBookmarks(nextBookmarks);
    });
  }, [user]);

  useEffect(() => {
    // 這邊存到 localStorage 是為了讓使用者自訂的分類對應在重新整理後仍可保留
    window.localStorage.setItem(modeCategoriesStorageKey, JSON.stringify(modeCategoryMap));
  }, [modeCategoryMap]);

  const bookmarksInCurrentMode = useMemo(
    () => bookmarks.filter((item) => resolveBookmarkMode(item, modeCategoryMap) === bookmarkMode),
    [bookmarks, bookmarkMode, modeCategoryMap],
  );

  const stats = useMemo(() => {
    const categories = new Set(bookmarksInCurrentMode.map((item) => item.category.trim()).filter(Boolean));
    return {
      total: bookmarksInCurrentMode.length,
      categories: categories.size,
    };
  }, [bookmarksInCurrentMode]);

  const categoryOptions = useMemo(() => {
    const modeCategories = modeCategoryMap[bookmarkMode] ?? [];
    const userCategories = Array.from(new Set(bookmarksInCurrentMode.map((item) => item.category.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'zh-Hant'));
    const merged = [...modeCategories, ...userCategories];

    return Array.from(new Set(merged));
  }, [bookmarksInCurrentMode, bookmarkMode, modeCategoryMap]);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, string>();

    bookmarksInCurrentMode.forEach((bookmark) => {
      const category = bookmark.category.trim() || '未分類';
      if (!map.has(category)) {
        map.set(category, bookmark.folderColor);
      }
    });

    return map;
  }, [bookmarksInCurrentMode]);

  const usedFolderColors = useMemo(() => new Set(bookmarksInCurrentMode.map((item) => item.folderColor)), [bookmarksInCurrentMode]);

  useEffect(() => {
    setCategoryFilter('all');
    setCategorySelection('__new__');
    setCustomCategory('');
    setForm((current) => ({
      ...current,
      category: '',
      folderColor: pickFolderColorForCategory(`mode-${bookmarkMode}`, usedFolderColors),
    }));
    draftCategoryNameRef.current = '';
    draftCategoryColorRef.current = '';
  }, [bookmarkMode]);

  function syncExistingCategory(category: string) {
    const nextColor = categoryColorMap.get(category) ?? pickFolderColorForCategory(category, usedFolderColors);
    draftCategoryNameRef.current = '';
    draftCategoryColorRef.current = '';
    setCategorySelection(category);
    setCustomCategory('');
    setForm((current) => ({
      ...current,
      category,
      folderColor: nextColor,
    }));
  }

  function startNewCategoryDraft() {
    setCategorySelection('__new__');
    setCustomCategory('');
    draftCategoryNameRef.current = '';
    draftCategoryColorRef.current = pickFolderColorForCategory('new-category', usedFolderColors);
    setForm((current) => ({
      ...current,
      category: '',
      folderColor: draftCategoryColorRef.current,
    }));
  }

  function syncCustomCategory(category: string) {
    const trimmed = category.trim();
    setCategorySelection('__new__');
    setCustomCategory(category);

    if (!trimmed) {
      setForm((current) => ({
        ...current,
        category: '',
        folderColor: pickFolderColorForCategory('new-category', usedFolderColors),
      }));
      return;
    }

    const existingColor = categoryColorMap.get(trimmed);
    if (existingColor) {
      draftCategoryNameRef.current = trimmed;
      draftCategoryColorRef.current = existingColor;
      setForm((current) => ({
        ...current,
        category: trimmed,
        folderColor: existingColor,
      }));
      return;
    }

    if (draftCategoryNameRef.current !== trimmed || !draftCategoryColorRef.current) {
      draftCategoryNameRef.current = trimmed;
      draftCategoryColorRef.current = pickFolderColorForCategory(trimmed, usedFolderColors);
    }

    setForm((current) => ({
      ...current,
      category: trimmed,
      folderColor: draftCategoryColorRef.current,
    }));
  }

  function handleOpenModeCategoryEditor() {
    setModeCategoryDraft(buildModeCategoryDraft(modeCategoryMap));
    setEditingModeCategories(true);
  }

  function handleCancelModeCategoryEditor() {
    setEditingModeCategories(false);
    setModeCategoryDraft(buildModeCategoryDraft(modeCategoryMap));
  }

  function handleSaveModeCategoryEditor() {
    const nextMap: ModeCategoryMap = {
      entertainment: parseCategoryInput(modeCategoryDraft.entertainment),
      study: parseCategoryInput(modeCategoryDraft.study),
      coding: parseCategoryInput(modeCategoryDraft.coding),
    };

    setModeCategoryMap(nextMap);
    setEditingModeCategories(false);
  }

  function beginRenameCategory(category: string) {
    const currentMode = findModeByExactCategory(category, modeCategoryMap) ?? bookmarkMode;
    setEditingCategoryName(category);
    setCategoryRenameDraft(category);
    setCategoryTargetMode(currentMode);
  }

  function cancelRenameCategory() {
    setEditingCategoryName(null);
    setCategoryRenameDraft('');
    setCategoryTargetMode(bookmarkMode);
    setRenamingCategory(false);
  }

  async function submitRenameCategory(oldCategory: string, targets: Bookmark[]) {
    if (!db || renamingCategory) {
      return;
    }
    const activeDb = db;

    const normalizedNewCategory = categoryRenameDraft.trim();
    if (!normalizedNewCategory) {
      setError('分類名稱不可空白。');
      return;
    }

    const currentMode = findModeByExactCategory(oldCategory, modeCategoryMap) ?? bookmarkMode;
    if (normalizedNewCategory === oldCategory && categoryTargetMode === currentMode) {
      cancelRenameCategory();
      return;
    }

    setRenamingCategory(true);
    setError('');

    const resolvedMode = categoryTargetMode;
    const timestamp = Date.now();

    try {
      // 批次更新同分類書籤，避免分類名稱一半成功一半失敗，造成清單資料看起來不一致
      await Promise.all(
        targets.map((bookmark) => updateDoc(doc(activeDb, 'bookmarks', bookmark.id), {
          category: normalizedNewCategory,
          bookmarkMode: resolvedMode,
          updatedAt: timestamp,
        })),
      );

      setModeCategoryMap((current) => {
        const removedOldCategoryMap: ModeCategoryMap = {
          entertainment: current.entertainment.filter((item) => item !== oldCategory),
          study: current.study.filter((item) => item !== oldCategory),
          coding: current.coding.filter((item) => item !== oldCategory),
        };

        const nextItems = [...removedOldCategoryMap[resolvedMode], normalizedNewCategory];
        return {
          ...removedOldCategoryMap,
          [resolvedMode]: normalizeCategories(nextItems),
        };
      });

      setCategoryFilter((current) => (current === oldCategory ? normalizedNewCategory : current));
      setCategorySelection((current) => (current === oldCategory ? normalizedNewCategory : current));
      setCustomCategory((current) => (current.trim() === oldCategory ? normalizedNewCategory : current));
      setForm((current) => ({
        ...current,
        category: current.category.trim() === oldCategory ? normalizedNewCategory : current.category,
      }));

      if (bookmarkMode !== resolvedMode) {
        setBookmarkMode(resolvedMode);
      }

      cancelRenameCategory();
    } catch (renameError) {
      setError(formatFirestoreError(renameError));
      setRenamingCategory(false);
    }
  }

  async function deleteCategory(category: string, targets: Bookmark[]) {
    if (!db || deletingCategory) {
      return;
    }

    if (category === '未分類') {
      setError('未分類不可刪除。');
      return;
    }

    const confirmed = window.confirm(`確定刪除分類「${category}」嗎？\n該分類書籤會移到「未分類」。`);
    if (!confirmed) {
      return;
    }

    setDeletingCategory(true);
    setError('');
    const activeDb = db;
    const timestamp = Date.now();

    try {
      // 刪除分類採用「移到未分類」而非刪資料，避免誤刪造成資料不可逆
      await Promise.all(
        targets.map((bookmark) => updateDoc(doc(activeDb, 'bookmarks', bookmark.id), {
          category: '未分類',
          updatedAt: timestamp,
        })),
      );

      setModeCategoryMap((current) => ({
        entertainment: current.entertainment.filter((item) => item !== category),
        study: current.study.filter((item) => item !== category),
        coding: current.coding.filter((item) => item !== category),
      }));

      if (editingCategoryName === category) {
        cancelRenameCategory();
      }

      setCategoryFilter((current) => (current === category ? 'all' : current));
      setCategorySelection((current) => (current === category ? '__new__' : current));
      setCustomCategory((current) => (current.trim() === category ? '' : current));
      setForm((current) => ({
        ...current,
        category: current.category.trim() === category ? '' : current.category,
      }));
    } catch (deleteError) {
      setError(formatFirestoreError(deleteError));
    } finally {
      setDeletingCategory(false);
    }
  }

  const filteredBookmarks = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return bookmarksInCurrentMode.filter((bookmark) => {
      const matchesCategory = categoryFilter === 'all' || (bookmark.category.trim() || '未分類') === categoryFilter;
      const haystack = [bookmark.title, bookmark.url, bookmark.siteDescription ?? '', bookmark.category, bookmark.notes].join(' ').toLowerCase();
      const matchesKeyword = keyword.length === 0 || haystack.includes(keyword);

      return matchesCategory && matchesKeyword;
    });
  }, [bookmarksInCurrentMode, categoryFilter, searchTerm]);

  const groupedBookmarks = useMemo(() => {
    const groups = new Map<string, Bookmark[]>();

    filteredBookmarks.forEach((bookmark) => {
      const groupName = bookmark.category.trim() || '未分類';
      const current = groups.get(groupName) ?? [];
      current.push(bookmark);
      groups.set(groupName, current);
    });

    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right, 'zh-Hant'))
      .map(([category, items]) => ({
        category,
        items: items.sort((left, right) => right.updatedAt - left.updatedAt),
      }));
  }, [filteredBookmarks]);

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setAuthMessage('');

    if (!auth || !firebaseReady) {
      const missingVars = getFirebaseConfigErrors();
      if (missingVars.length > 0) {
        setError(`Firebase 設定不完整，缺失：${missingVars.join(', ')}`);
      } else {
        setError('Firebase 尚未完成設定。');
      }
      return;
    }

    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
        setAuthMessage('已成功登入。');
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        setAuthMessage('帳號已建立。');
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : '認證失敗。');
    }
  }

  async function handleSaveBookmark(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !db) {
      return;
    }

    const normalizedUrl = normalizeUrl(form.url);
    const normalizedCategory = form.category.trim();
    if (!form.title.trim()) {
      setError('請輸入標題。');
      return;
    }

    if (!normalizedUrl || !isValidUrl(normalizedUrl)) {
      setError('請輸入有效網址。');
      return;
    }

    if (!normalizedCategory) {
      setError('請選擇或輸入分類。');
      return;
    }

    setSaving(true);
    setError('');

    const resolvedColor = categoryColorMap.get(normalizedCategory) ?? pickFolderColorForCategory(normalizedCategory, usedFolderColors);
    const siteMetadata = await fetchSiteMetadata(normalizedUrl);
    const mappedMode = findModeByExactCategory(normalizedCategory, modeCategoryMap);
    const resolvedBookmarkMode = mappedMode ?? bookmarkMode;

    const timestamp = Date.now();
    const payload = {
      title: form.title.trim(),
      url: normalizedUrl,
      category: normalizedCategory,
      bookmarkMode: resolvedBookmarkMode,
      siteDescription: siteMetadata.siteDescription,
      faviconUrl: siteMetadata.faviconUrl,
      notes: form.notes.trim(),
      folderColor: resolvedColor,
      ownerUid: user.uid,
      updatedAt: timestamp,
    };

    try {
      if (editingId) {
        await updateDoc(doc(db, 'bookmarks', editingId), payload);
      } else {
        await addDoc(collection(db, 'bookmarks'), {
          ...payload,
          createdAt: timestamp,
        });
      }

      setForm(emptyForm);
      setEditingId(null);
      setCategorySelection('__new__');
      setCustomCategory('');
      draftCategoryNameRef.current = '';
      draftCategoryColorRef.current = '';
    } catch (saveError) {
      setError(formatFirestoreError(saveError));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(bookmark: Bookmark) {
    setEditingId(bookmark.id);
    const category = bookmark.category.trim();

    if (category && (categoryOptions.includes(category) || categoryColorMap.has(category))) {
      setCategorySelection(category);
      setCustomCategory('');
      draftCategoryNameRef.current = '';
      draftCategoryColorRef.current = '';
    } else {
      setCategorySelection('__new__');
      setCustomCategory(category);
      draftCategoryNameRef.current = category;
      draftCategoryColorRef.current = bookmark.folderColor;
    }

    setForm({
      title: bookmark.title,
      url: bookmark.url,
      category: bookmark.category,
      notes: bookmark.notes,
      folderColor: bookmark.folderColor,
    });
  }

  async function removeBookmark(id: string) {
    if (!db) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'bookmarks', id));
    } catch (deleteError) {
      setError(formatFirestoreError(deleteError));
    }
  }

  async function handleLogout() {
    if (!auth) {
      return;
    }

    await signOut(auth);
    setEditingId(null);
    setForm(emptyForm);
    setCategorySelection('__new__');
    setCustomCategory('');
  }

  if (loading) {
    return <main className="shell centered">載入中...</main>;
  }

  if (!user) {
    return (
      <main className="shell auth-shell">
        <section className="hero-card">
          <p className="eyebrow">冥夜書籤小站</p>
          <h1>把你的常用網站收進一個安靜、好整理的空間。</h1>
          <p className="lead">註冊、登入、編輯、同步都在同一頁完成。適合個人收藏，也適合長期整理。</p>
          <ul className="feature-list">
            <li>帳號密碼登入與註冊</li>
            <li>Firestore 雲端同步</li>
            <li>GitHub Pages 可直接部署</li>
          </ul>
        </section>

        <section className="panel auth-panel">
          {!firebaseReady ? <p className="error">Firebase 設定尚未完成，目前可能無法登入。</p> : null}
          <div className="segmented" role="tablist" aria-label="登入模式切換">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} type="button">登入</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')} type="button">註冊</button>
          </div>

          <form className="form" onSubmit={handleAuthSubmit}>
            <label>
              <span>電子郵件</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              <span>密碼</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} />
            </label>
            <button className="primary" type="submit">{mode === 'login' ? '登入' : '建立帳號'}</button>
          </form>

          {authMessage ? <p className="success">{authMessage}</p> : null}
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="shell dashboard-shell">
      <header className="topbar panel">
        <div>
          <p className="eyebrow">已登入</p>
          <h1>冥夜書籤小站</h1>
          <p className="muted">{user.email}</p>
        </div>
        <button className="ghost" type="button" onClick={handleLogout}>登出</button>
      </header>

      <section className="stats-grid">
        <article className="panel stat-card">
          <span>書籤總數</span>
          <strong>{stats.total}</strong>
        </article>
        <article className="panel stat-card">
          <span>分類數量</span>
          <strong>{stats.categories}</strong>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel form-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">{editingId ? '編輯書籤' : '新增書籤'}</p>
              <h2>{editingId ? '更新目前內容' : '加入新收藏'}</h2>
            </div>
            {editingId ? <button className="ghost" type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>取消編輯</button> : null}
          </div>

          <form className="form" onSubmit={handleSaveBookmark}>
            <label>
              <span>標題</span>
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
            </label>
            <label>
              <span>網址</span>
              <input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} required placeholder="https://example.com" />
            </label>
            <label>
              <span>分類</span>
              <select value={categorySelection} onChange={(event) => {
                const value = event.target.value;
                if (value === '__new__') {
                  startNewCategoryDraft();
                  return;
                }

                syncExistingCategory(value);
              }}>
                <option value="__new__">新增分類</option>
                {categoryOptions.length > 0 ? categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                )) : null}
              </select>
              {categorySelection === '__new__' ? (
                <input
                  value={customCategory}
                  onChange={(event) => syncCustomCategory(event.target.value)}
                  placeholder="輸入新的分類名稱"
                  required
                />
              ) : null}
            </label>
            <label>
              <span>備註</span>
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={4} />
            </label>
            <button className="primary" type="submit" disabled={saving}>{saving ? '儲存中...' : editingId ? '更新書籤' : '新增書籤'}</button>
          </form>
          {error ? <p className="error">{error}</p> : null}
        </article>

        <article className="panel list-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">你的收藏</p>
              <h2>書籤清單</h2>
            </div>
            <div className="section-controls">
              <div className="mode-switch" role="tablist" aria-label="書籤模式切換">
                {modeOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="tab"
                    aria-selected={bookmarkMode === option.key}
                    className={bookmarkMode === option.key ? 'active' : ''}
                    onClick={() => setBookmarkMode(option.key)}
                  >
                    <span aria-hidden="true">{option.icon}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
              <button className="ghost mode-config-toggle" type="button" onClick={editingModeCategories ? handleCancelModeCategoryEditor : handleOpenModeCategoryEditor}>
                {editingModeCategories ? '取消設定' : '編輯分類模式'}
              </button>
            </div>
          </div>

          {editingModeCategories ? (
            <section className="mode-config-panel" aria-label="分類模式設定">
              <p className="mode-config-hint">可用逗號或換行分隔分類名稱，儲存後會影響各模式的預設分類呈現。</p>
              <div className="mode-config-grid">
                {modeOptions.map((option) => (
                  <label key={option.key} className="mode-config-field">
                    <span>{option.icon} {option.label}分類</span>
                    <textarea
                      rows={4}
                      value={modeCategoryDraft[option.key]}
                      onChange={(event) => setModeCategoryDraft((current) => ({
                        ...current,
                        [option.key]: event.target.value,
                      }))}
                      placeholder="例如：影片, 音樂, 社群"
                    />
                  </label>
                ))}
              </div>
              <div className="mode-config-actions">
                <button className="ghost" type="button" onClick={handleCancelModeCategoryEditor}>取消</button>
                <button className="primary" type="button" onClick={handleSaveModeCategoryEditor}>儲存分類設定</button>
              </div>
            </section>
          ) : null}

          <div className="toolbar">
            <label>
              <span>搜尋</span>
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜尋標題、網址、備註" />
            </label>
            <label>
              <span>分類篩選</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">全部分類</option>
                <option value="未分類">未分類</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="group-summary">
            <span>{filteredBookmarks.length} 筆符合條件</span>
            <span>{groupedBookmarks.length} 個收藏夾</span>
          </div>

          <div className="grouped-list">
            {bookmarksInCurrentMode.length === 0 ? <p className="empty">此模式目前還沒有書籤，先新增第一筆。</p> : null}
            {bookmarksInCurrentMode.length > 0 && filteredBookmarks.length === 0 ? <p className="empty">沒有符合條件的書籤。</p> : null}

            {groupedBookmarks.map((group) => (
              <section className="bookmark-group" key={group.category}>
                <div className="group-header">
                  <div className="group-title-wrap">
                    {editingCategoryName === group.category ? (
                      <div className="category-rename-inline">
                        <input
                          value={categoryRenameDraft}
                          onChange={(event) => setCategoryRenameDraft(event.target.value)}
                          placeholder="輸入新的分類名稱"
                          aria-label="新的分類名稱"
                        />
                        <select
                          value={categoryTargetMode}
                          onChange={(event) => setCategoryTargetMode(event.target.value as BookmarkMode)}
                          aria-label="分類目標模式"
                        >
                          {modeOptions.map((option) => (
                            <option key={option.key} value={option.key}>{option.icon} {option.label}</option>
                          ))}
                        </select>
                        <button className="primary" type="button" disabled={renamingCategory} onClick={() => { void submitRenameCategory(group.category, group.items); }}>
                          {renamingCategory ? '儲存中...' : '儲存'}
                        </button>
                        <button className="ghost" type="button" disabled={renamingCategory} onClick={cancelRenameCategory}>取消</button>
                        <button className="ghost danger" type="button" disabled={renamingCategory || deletingCategory} onClick={() => { void deleteCategory(group.category, group.items); }}>
                          {deletingCategory ? '刪除中...' : '刪除分類'}
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3>{group.category}</h3>
                        <button className="ghost rename-category-btn" type="button" onClick={() => beginRenameCategory(group.category)}>改名</button>
                        <button className="ghost danger rename-category-btn" type="button" disabled={deletingCategory} onClick={() => { void deleteCategory(group.category, group.items); }}>
                          {deletingCategory ? '刪除中...' : '刪除分類'}
                        </button>
                      </>
                    )}
                  </div>
                  <span className="group-count">{group.items.length}</span>
                </div>

                <div className="bookmark-list">
                  {group.items.map((bookmark) => {
                    const cardStyle: CSSProperties & { '--folder-color': string } = {
                      borderLeftColor: bookmark.folderColor,
                      '--folder-color': bookmark.folderColor,
                    };

                    return (
                    <article className="bookmark-card" key={bookmark.id} style={cardStyle}>
                      <div className="bookmark-meta">
                        <div className="bookmark-site">
                          <p className="site-preview">
                            <img
                              className="site-favicon"
                              src={getBookmarkFavicon(bookmark)}
                              alt="網站圖標"
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                            />
                            <span>{getBookmarkDescription(bookmark)}</span>
                          </p>
                          <h4>{bookmark.title}</h4>
                          <p className="site-domain">{getBookmarkHostname(bookmark.url)}</p>
                        </div>
                        <a href={bookmark.url} target="_blank" rel="noreferrer">開啟</a>
                      </div>
                      {bookmark.notes ? <p className="notes">{bookmark.notes}</p> : null}
                      <div className="bookmark-actions">
                        <button className="ghost" type="button" onClick={() => startEdit(bookmark)}>編輯</button>
                        <button className="ghost danger" type="button" onClick={() => removeBookmark(bookmark.id)}>刪除</button>
                      </div>
                    </article>
                  );
                  })}
                </div>
              </section>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

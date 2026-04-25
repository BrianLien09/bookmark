import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { auth, db, firebaseReady, getFirebaseConfigErrors } from './firebase';
import type { AuthMode, Bookmark, BookmarkFormState } from './types';

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
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

  const stats = useMemo(() => {
    const categories = new Set(bookmarks.map((item) => item.category.trim()).filter(Boolean));
    return {
      total: bookmarks.length,
      categories: categories.size,
    };
  }, [bookmarks]);

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(bookmarks.map((item) => item.category.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'zh-Hant'));
  }, [bookmarks]);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, string>();

    bookmarks.forEach((bookmark) => {
      const category = bookmark.category.trim() || '未分類';
      if (!map.has(category)) {
        map.set(category, bookmark.folderColor);
      }
    });

    return map;
  }, [bookmarks]);

  const usedFolderColors = useMemo(() => new Set(bookmarks.map((item) => item.folderColor)), [bookmarks]);

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

  const filteredBookmarks = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return bookmarks.filter((bookmark) => {
      const matchesCategory = categoryFilter === 'all' || (bookmark.category.trim() || '未分類') === categoryFilter;
      const haystack = [bookmark.title, bookmark.url, bookmark.siteDescription ?? '', bookmark.category, bookmark.notes].join(' ').toLowerCase();
      const matchesKeyword = keyword.length === 0 || haystack.includes(keyword);

      return matchesCategory && matchesKeyword;
    });
  }, [bookmarks, categoryFilter, searchTerm]);

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

    const timestamp = Date.now();
    const payload = {
      title: form.title.trim(),
      url: normalizedUrl,
      category: normalizedCategory,
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
          <p className="eyebrow">Bookmark Vault</p>
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
          <h1>Bookmark Vault</h1>
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
          </div>

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
            {bookmarks.length === 0 ? <p className="empty">目前還沒有書籤，先新增第一筆。</p> : null}
            {bookmarks.length > 0 && filteredBookmarks.length === 0 ? <p className="empty">沒有符合條件的書籤。</p> : null}

            {groupedBookmarks.map((group) => (
              <section className="bookmark-group" key={group.category}>
                <div className="group-header">
                  <div className="group-title-wrap">
                    <h3>{group.category}</h3>
                  </div>
                  <span className="group-count">{group.items.length}</span>
                </div>

                <div className="bookmark-list">
                  {group.items.map((bookmark) => (
                    <article className="bookmark-card" key={bookmark.id} style={{ borderLeftColor: bookmark.folderColor }}>
                      <div className="bookmark-meta">
                        <div>
                          <h4>{bookmark.title}</h4>
                          <p className="site-preview">
                            <img
                              className="site-favicon"
                              src={bookmark.faviconUrl || buildDefaultFavicon(new URL(bookmark.url))}
                              alt="網站圖標"
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                            />
                            <span>{bookmark.siteDescription?.trim() || buildDefaultDescription(new URL(bookmark.url))}</span>
                          </p>
                        </div>
                        <a href={bookmark.url} target="_blank" rel="noreferrer">開啟</a>
                      </div>
                      {bookmark.notes ? <p className="notes">{bookmark.notes}</p> : null}
                      <div className="bookmark-actions">
                        <button className="ghost" type="button" onClick={() => startEdit(bookmark)}>編輯</button>
                        <button className="ghost danger" type="button" onClick={() => removeBookmark(bookmark.id)}>刪除</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

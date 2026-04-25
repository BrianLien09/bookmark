export type Bookmark = {
  id: string;
  title: string;
  url: string;
  siteDescription?: string;
  faviconUrl?: string;
  category: string;
  notes: string;
  folderColor: string;
  ownerUid: string;
  createdAt: number;
  updatedAt: number;
};

export type BookmarkFormState = Omit<Bookmark, 'id' | 'ownerUid' | 'createdAt' | 'updatedAt'>;

export type AuthMode = 'login' | 'register';

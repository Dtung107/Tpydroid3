import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  type Auth,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  getApiBaseUrl,
  isAndroidApkEnvironment,
  RENDER_CLOUD_API_URL,
  DEFAULT_CLOUD_API_URL,
} from './apiConfig';

export const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
];

let auth: Auth | null = null;
try {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (err) {
  console.warn('Firebase Auth init skipped:', err);
}
export { auth };

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account' });

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token & APK bridge user strictly in memory (never localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let cachedApkUser: User | null = null;

type AuthCallbacks = {
  onAuthSuccess?: (user: User, token: string | null) => void;
  onAuthSignedOutOrNeedsToken?: (user: User | null) => void;
};

let activeCallbacks: AuthCallbacks = {};

let pendingApkResolve: ((val: { user: User; accessToken: string } | null) => void) | null = null;
let pendingApkReject: ((err: Error) => void) | null = null;
let pendingApkTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingApkPromise() {
  if (pendingApkTimer) {
    clearTimeout(pendingApkTimer);
    pendingApkTimer = null;
  }
  pendingApkResolve = null;
  pendingApkReject = null;
}

function getCapacitorPlugin<T = any>(name: string): T | null {
  try {
    if (typeof window === 'undefined') return null;
    return ((window as any).Capacitor?.Plugins?.[name] as T) || null;
  } catch (_) {
    return null;
  }
}

async function fetchGoogleUserProfile(accessToken: string, fallback: {
  name?: string;
  email?: string;
  photo?: string;
}): Promise<User> {
  let name = fallback.name || '';
  let email = fallback.email || '';
  let photo = fallback.photo || '';
  let sub = '';

  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const info = await res.json();
      name = info.name || name;
      email = info.email || email;
      photo = info.picture || photo;
      sub = info.sub || '';
    }
  } catch (_) {
    // Fallback cleanly to deep-link metadata
  }

  return {
    uid: sub || `google_${email || Date.now()}`,
    displayName: name || email || 'Người dùng Google',
    email: email || null,
    photoURL: photo || null,
    emailVerified: true,
    isAnonymous: false,
    providerId: 'google.com',
  } as unknown as User;
}

async function handleApkOAuthCallbackUrl(rawUrl: string): Promise<boolean> {
  if (!rawUrl || !rawUrl.startsWith('com.pydroid3.webide://oauth')) {
    return false;
  }

  const browserPlugin = getCapacitorPlugin<{ close?: () => Promise<void> }>('Browser');
  try {
    if (browserPlugin?.close) {
      await Promise.resolve(browserPlugin.close());
    }
  } catch (_) {}

  const hashPart = rawUrl.includes('#') ? rawUrl.split('#')[1] : rawUrl.split('?')[1] || '';
  const params = new URLSearchParams(hashPart);
  const oauthError = params.get('error');
  if (oauthError) {
    const err = new Error(decodeURIComponent(oauthError));
    isSigningIn = false;
    if (pendingApkReject) {
      const reject = pendingApkReject;
      clearPendingApkPromise();
      reject(err);
    }
    return true;
  }

  const accessToken = params.get('access_token') || '';
  const idToken = params.get('id_token') || '';
  if (!accessToken) {
    const err = new Error('Không nhận được mã truy cập Google từ trình duyệt Chrome.');
    isSigningIn = false;
    if (pendingApkReject) {
      const reject = pendingApkReject;
      clearPendingApkPromise();
      reject(err);
    }
    return true;
  }

  cachedAccessToken = accessToken;
  let signedUser: User | null = null;

  if (idToken && auth) {
    try {
      const cred = GoogleAuthProvider.credential(idToken, accessToken);
      const userCred = await signInWithCredential(auth, cred);
      signedUser = userCred.user;
    } catch (_) {
      // Fallback to in-memory Google profile if localhost is not yet allowlisted in Firebase Console
    }
  }

  if (!signedUser) {
    signedUser = await fetchGoogleUserProfile(accessToken, {
      name: params.get('name') || '',
      email: params.get('email') || '',
      photo: params.get('photo') || '',
    });
    cachedApkUser = signedUser;
  } else {
    cachedApkUser = null;
  }

  isSigningIn = false;
  activeCallbacks.onAuthSuccess?.(signedUser, cachedAccessToken);

  if (pendingApkResolve) {
    const resolve = pendingApkResolve;
    clearPendingApkPromise();
    resolve({ user: signedUser, accessToken: cachedAccessToken });
  }
  return true;
}

/**
 * Initialize auth state listener & Capacitor Deep-Link callback listener. Call on app load.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthSignedOutOrNeedsToken?: (user: User | null) => void
) => {
  activeCallbacks = { onAuthSuccess, onAuthSignedOutOrNeedsToken };

  let unsubscribeFirebase: () => void = () => {};
  if (auth) {
    try {
      unsubscribeFirebase = onAuthStateChanged(auth, (user: User | null) => {
        const effectiveUser = user || cachedApkUser;
        if (effectiveUser) {
          if (cachedAccessToken) {
            onAuthSuccess?.(effectiveUser, cachedAccessToken);
          } else if (!isSigningIn) {
            cachedAccessToken = null;
            onAuthSignedOutOrNeedsToken?.(effectiveUser);
          }
        } else {
          cachedAccessToken = null;
          onAuthSignedOutOrNeedsToken?.(null);
        }
      });
    } catch (err) {
      console.warn('onAuthStateChanged failed:', err);
    }
  }

  let appListenerHandle: { remove?: () => Promise<void> | void } | null = null;
  const appPlugin = getCapacitorPlugin<{
    addListener?: (
      eventName: string,
      listenerFunc: (data: { url?: string }) => void
    ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
    getLaunchUrl?: () => Promise<{ url?: string } | undefined>;
  }>('App');

  if (appPlugin && typeof appPlugin.addListener === 'function') {
    try {
      // Capacitor native-bridge.js returns { remove } synchronously (not a Promise),
      // while @capacitor/app JS wrapper returns a Promise<PluginListenerHandle>. Handle both!
      const handleOrPromise = appPlugin.addListener('appUrlOpen', (data) => {
        if (data?.url) {
          handleApkOAuthCallbackUrl(data.url).catch(() => {});
        }
      });
      if (handleOrPromise && typeof (handleOrPromise as any).then === 'function') {
        (handleOrPromise as Promise<{ remove?: () => Promise<void> }>)
          .then((handle) => {
            if (handle) appListenerHandle = handle;
          })
          .catch(() => {});
      } else if (handleOrPromise && typeof (handleOrPromise as any).remove === 'function') {
        appListenerHandle = handleOrPromise as { remove?: () => Promise<void> };
      }
    } catch (err) {
      console.warn('Capacitor App.addListener skipped:', err);
    }
  }

  if (appPlugin && typeof appPlugin.getLaunchUrl === 'function') {
    try {
      Promise.resolve(appPlugin.getLaunchUrl())
        .then((res) => {
          if (res?.url) {
            handleApkOAuthCallbackUrl(res.url).catch(() => {});
          }
        })
        .catch(() => {});
    } catch (_) {}
  }

  return () => {
    try {
      unsubscribeFirebase();
    } catch (_) {}
    try {
      Promise.resolve(appListenerHandle?.remove?.()).catch(() => {});
    } catch (_) {}
  };
};

/**
 * Web-only Firebase popup sign-in helper used both on standard Web and the APK Chrome Custom Tab bridge (?apk_oauth=1).
 */
export const runWebPopupForApkBridge = async (): Promise<{
  user: User;
  accessToken: string;
  idToken: string;
}> => {
  if (!auth) {
    throw new Error('Firebase Authentication chưa sẵn sàng.');
  }
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không nhận được quyền truy cập Google từ cửa sổ đăng nhập.');
    }
    cachedAccessToken = credential.accessToken;
    return {
      user: result.user,
      accessToken: credential.accessToken,
      idToken: credential.idToken || '',
    };
  } finally {
    isSigningIn = false;
  }
};

function getApkBridgeBaseUrl(): string {
  const configured = getApiBaseUrl();
  if (configured && configured.startsWith('https://')) {
    return configured;
  }
  return RENDER_CLOUD_API_URL || DEFAULT_CLOUD_API_URL;
}

/**
 * Sign in with Google:
 * - On Web Chrome: standard Firebase popup.
 * - On Android APK: opens Chrome Custom Tab bridge (?apk_oauth=1) to bypass WebView disallowed_useragent and returns via com.pydroid3.webide://oauth#...
 */
export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  if (isAndroidApkEnvironment()) {
    const browserPlugin = getCapacitorPlugin<{
      open?: (opts: { url: string; presentationStyle?: string }) => Promise<void>;
    }>('Browser');
    const appPlugin = getCapacitorPlugin('App');
    const bridgeUrl = `${getApkBridgeBaseUrl()}/?apk_oauth=1`;

    if (browserPlugin?.open && appPlugin) {
      isSigningIn = true;
      clearPendingApkPromise();

      return new Promise(async (resolve, reject) => {
        pendingApkResolve = resolve;
        pendingApkReject = reject;
        pendingApkTimer = setTimeout(() => {
          if (pendingApkReject) {
            isSigningIn = false;
            const r = pendingApkReject;
            clearPendingApkPromise();
            r(new Error('Quá thời gian chờ đăng nhập từ trình duyệt Chrome. Nếu bạn đã đăng nhập trên Chrome, hãy nhấn nút "Quay lại ứng dụng Pydroid 3" trên Chrome hoặc thử lại.'));
          }
        }, 180000);

        try {
          await browserPlugin.open!({ url: bridgeUrl });
        } catch (openErr: any) {
          isSigningIn = false;
          clearPendingApkPromise();
          reject(new Error(openErr?.message || 'Không thể mở Chrome Custom Tabs để đăng nhập Google.'));
        }
      });
    }

    throw new Error(
      `Phiên bản APK đang cài chưa có mô-đun Chrome Custom Tabs để quay về ứng dụng tự động. Hãy tải "Vá Mã Nguồn" trong mục Đóng Gói APK để build lại bản APK mới, hoặc bấm nút "Mở bản Render Web trên Chrome" bên dưới.`
    );
  }

  try {
    if (!auth) {
      throw new Error('Firebase Authentication chưa sẵn sàng.');
    }
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không nhận được quyền truy cập Google từ cửa sổ đăng nhập.');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    const code = error?.code || '';
    const msg = String(error?.message || '');
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        `Tên miền "${hostname || 'hiện tại'}" chưa được cấp phép trong Firebase Console (Project ${firebaseConfig.projectId} ➔ Authentication ➔ Settings ➔ Authorized domains). Hãy thêm "${hostname}" vào danh sách tên miền được phép rồi thử lại.`
      );
    }
    if (msg.includes('disallowed_useragent') || code === 'auth/web-storage-unsupported') {
      throw new Error(
        'Trình duyệt tích hợp hiện tại bị Google OAuth chặn đăng nhập (disallowed_useragent). Hãy mở ứng dụng trực tiếp bằng trình duyệt Chrome.'
      );
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Bạn đã đóng cửa sổ đăng nhập Google.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Trình duyệt đang chặn cửa sổ bật lên. Vui lòng cho phép popup để đăng nhập Google.');
    }
    if (code === 'auth/operation-not-allowed') {
      throw new Error('Nhà cung cấp đăng nhập Google chưa được kích hoạt trong Firebase Authentication.');
    }
    if (code === 'auth/network-request-failed') {
      throw new Error('Lỗi kết nối mạng khi xác thực Google. Vui lòng kiểm tra Internet.');
    }
    throw new Error(msg ? `Lỗi đăng nhập Google (${code || 'auth'}): ${msg}` : 'Không thể đăng nhập bằng Google lúc này.');
  } finally {
    if (!isAndroidApkEnvironment()) {
      isSigningIn = false;
    }
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const clearCachedAccessToken = (): void => {
  cachedAccessToken = null;
};

export const logout = async (): Promise<void> => {
  cachedAccessToken = null;
  cachedApkUser = null;
  clearPendingApkPromise();
  if (auth) {
    await auth.signOut().catch(() => {});
  }
  activeCallbacks.onAuthSignedOutOrNeedsToken?.(null);
};

import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, ExternalLink, ArrowLeft } from 'lucide-react';
import { GoogleSignInButton } from './GoogleSignInButton';
import { runWebPopupForApkBridge } from '../utils/googleAuth';
import { DEFAULT_CLOUD_API_URL } from '../utils/apiConfig';
import firebaseConfig from '../../firebase-applet-config.json';

export const ApkOAuthBridge: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [signedAccount, setSignedAccount] = useState<string | null>(null);

  const handleBridgeLogin = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await runWebPopupForApkBridge();
      const params = new URLSearchParams({
        access_token: res.accessToken,
        id_token: res.idToken || '',
        name: res.user.displayName || '',
        email: res.user.email || '',
        photo: res.user.photoURL || '',
      });
      const link = `com.pydroid3.webide://oauth#${params.toString()}`;
      setDeepLinkUrl(link);
      setSignedAccount(res.user.displayName || res.user.email || 'Tài khoản Google');
      window.location.href = link;
    } catch (err: any) {
      const code = err?.code || '';
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      if (code === 'auth/unauthorized-domain') {
        setErrorMsg(
          `Tên miền "${host}" chưa được thêm vào Authorized domains của Firebase Project "${firebaseConfig.projectId}". Bạn có thể thêm "${host}" trong Firebase Console hoặc bấm nút dùng máy chủ AI Studio bên dưới.`
        );
      } else {
        setErrorMsg(err?.message || 'Không thể đăng nhập Google lúc này.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#12121b] text-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#1a1a28] border border-[#2f2e48] rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="space-y-1">
          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/35">
            Pydroid 3 APK • Đăng nhập Google An toàn
          </span>
          <h1 className="text-base font-bold text-white">
            Kết nối Tài khoản Google &amp; Drive
          </h1>
          <p className="text-xs text-gray-400 leading-relaxed">
            Xác thực qua trình duyệt Chrome để tránh chặn WebView, sau đó hệ thống sẽ tự động đưa bạn quay lại ứng dụng <code className="text-sky-300">Pydroid 3 APK</code>.
          </p>
        </div>

        {deepLinkUrl ? (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Đã xác thực: {signedAccount}</div>
                <div className="text-[11px] text-emerald-300/80 mt-0.5">
                  Nếu ứng dụng chưa tự chuyển về trong 2 giây, hãy bấm nút bên dưới:
                </div>
              </div>
            </div>
            <a
              href={deepLinkUrl}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs flex items-center justify-center space-x-2 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Quay lại ứng dụng Pydroid 3 APK</span>
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <GoogleSignInButton
              onClick={handleBridgeLogin}
              isLoading={isLoading}
              label="Đăng nhập bằng Google"
            />
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-950/45 border border-rose-500/40 text-rose-200 text-[11px] space-y-2">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            {typeof window !== 'undefined' &&
              !window.location.origin.startsWith(DEFAULT_CLOUD_API_URL) && (
                <a
                  href={`${DEFAULT_CLOUD_API_URL}/?apk_oauth=1`}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 font-bold text-[11px] transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Đăng nhập qua máy chủ AI Studio (đã cấp phép)</span>
                </a>
              )}
          </div>
        )}
      </div>
    </div>
  );
};

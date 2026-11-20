import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  Layers,
  FileCode,
  ShieldCheck,
  AlertTriangle,
  Globe,
  CheckCircle2,
  Zap,
  Package,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import JSZip from 'jszip';
import { getApiUrl, RENDER_CLOUD_API_URL } from '../utils/apiConfig';
import firebaseConfig from '../../firebase-applet-config.json';

interface ExportApkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportTab = 'update' | 'full';
type UpdateScope = 'latest' | 'update';

interface ExportInfoData {
  latestCount: number;
  latestFiles: string[];
  latestRawKb: number;
  updateCount: number;
  updateFiles: string[];
  updateRawKb: number;
}

const FALLBACK_LATEST_FILES = [
  'src/utils/apiConfig.ts',
  'src/utils/linter.ts',
  'src/components/SettingsModal.tsx',
  'src/components/ExportApkModal.tsx',
  'src/components/Editor.tsx',
  'src/components/Terminal.tsx',
  'src/components/AiAssistantModal.tsx',
  'src/App.tsx',
  'index.html',
  'server.ts',
  'firebase-applet-config.json',
  'capacitor.config.json',
  '.github/workflows/build-apk.yml',
];

export const ExportApkModal: React.FC<ExportApkModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<ExportTab>('update');
  const [updateScope, setUpdateScope] = useState<UpdateScope>('latest');
  const [showFileList, setShowFileList] = useState<boolean>(true);
  const [exportInfo, setExportInfo] = useState<ExportInfoData | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState<boolean>(false);

  const [copiedWorkflow, setCopiedWorkflow] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [activeStep, setActiveStep] = useState<number>(1);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  const fetchExportInfo = async () => {
    setIsLoadingInfo(true);
    try {
      const res = await fetch(getApiUrl('/api/project/export-info'));
      if (res.ok) {
        const data = await res.json();
        if (data?.success) {
          setExportInfo(data);
        }
      }
    } catch (_) {
      // Offline / fallback handled gracefully
    } finally {
      setIsLoadingInfo(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDownloadError(null);
      setDownloadSuccess(null);
      fetchExportInfo();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const workflowSnippet = `name: Build Android APK for Pydroid 3 Web
on:
  push:
    branches: [ "main", "master" ]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - name: Accept Android SDK Licenses
        run: |
          SDK_MGR="\${ANDROID_HOME:-/usr/local/lib/android/sdk}/cmdline-tools/latest/bin/sdkmanager"
          if [ -x "\$SDK_MGR" ]; then
            yes | "\$SDK_MGR" --licenses >/dev/null 2>&1 || true
          else
            yes | sdkmanager --licenses >/dev/null 2>&1 || true
          fi
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --legacy-peer-deps --no-audit
      - run: npm install --legacy-peer-deps --no-save @capacitor/core@6.2.0 @capacitor/cli@6.2.0 @capacitor/android@6.2.0
      - run: npm run build
      - run: npx cap add android || true
      - run: if [ -d "resources/android-res" ]; then cp -rf resources/android-res/* android/app/src/main/res/; fi
      - run: npx cap sync android
      - run: cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon --stacktrace
      - uses: actions/upload-artifact@v4
        with:
          name: Pydroid3-Android-APK
          path: android/app/build/outputs/apk/debug/app-debug.apk`;

  const triggerZipDownload = (
    blob: Blob,
    kbSize: number,
    filename: string,
    fileCount?: number
  ) => {
    // Strategy A: Standard Object URL
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = blobUrl;
    link.download = filename;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      try {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      } catch (_) {}
    }, 4000);

    // Strategy B: Base64 Data URI for Android mobile WebViews
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        if (dataUrl && dataUrl.startsWith('data:')) {
          const mobileLink = document.createElement('a');
          mobileLink.style.display = 'none';
          mobileLink.href = dataUrl;
          mobileLink.download = filename;
          mobileLink.setAttribute('download', filename);
          document.body.appendChild(mobileLink);
          mobileLink.click();
          setTimeout(() => {
            try {
              document.body.removeChild(mobileLink);
            } catch (_) {}
          }, 3000);
        }
      };
      reader.readAsDataURL(blob);
    } catch (_) {}

    const countText = fileCount ? ` (${fileCount} tệp)` : '';
    setDownloadSuccess(
      `Đã tải thành công file ${filename}${countText} • ${Math.max(1, kbSize)} KB! Kiểm tra thư mục Download trên điện thoại.`
    );
  };

  const handleDownloadZip = async (mode: 'full' | 'update' | 'latest') => {
    setIsDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(null);

    const defaultFilename =
      mode === 'latest'
        ? 'pydroid3-latest-patch.zip'
        : mode === 'update'
        ? 'pydroid3-update-files.zip'
        : 'pydroid3-source-code.zip';

    // Tier 1: Base64 API endpoint via active backend URL
    try {
      const res = await fetch(getApiUrl(`/api/project/export-zip?mode=${mode}&format=base64`));
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.base64) {
          const binaryString = window.atob(data.base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes.buffer], { type: 'application/zip' });
          triggerZipDownload(
            blob,
            Math.round(data.size / 1024),
            data.filename || defaultFilename,
            data.fileCount
          );
          setIsDownloading(false);
          return;
        }
      }
    } catch (_) {}

    // Tier 2: Direct binary stream endpoint via active backend URL
    try {
      const resStream = await fetch(getApiUrl(`/api/project/export-zip?mode=${mode}`));
      if (resStream.ok) {
        const blob = await resStream.blob();
        if (!blob.type.includes('html') && blob.size > 500) {
          triggerZipDownload(blob, Math.round(blob.size / 1024), defaultFilename);
          setIsDownloading(false);
          return;
        }
      }
    } catch (_) {}

    // Tier 3: Zero-Failure On-Device JSZip Fallback (works offline)
    try {
      const zip = new JSZip();

      zip.file('.github/workflows/build-apk.yml', workflowSnippet);
      zip.file('firebase-applet-config.json', JSON.stringify(firebaseConfig, null, 2));
      zip.file(
        'capacitor.config.json',
        JSON.stringify(
          {
            appId: 'com.pydroid3.webide',
            appName: 'Pydroid 3 Web',
            webDir: 'dist',
            server: {
              androidScheme: 'https',
              cleartext: true,
            },
            android: {
              allowMixedContent: true,
              captureInput: false,
              webContentsDebuggingEnabled: true,
            },
          },
          null,
          2
        )
      );

      if (mode === 'full') {
        zip.file(
          'package.json',
          JSON.stringify(
            {
              name: 'pydroid3-web-ide',
              private: true,
              version: '1.0.0',
              type: 'module',
              scripts: {
                dev: 'tsx server.ts',
                build: 'vite build',
                preview: 'vite preview',
              },
              dependencies: {
                react: '^19.0.1',
                'react-dom': '^19.0.1',
                pyodide: '0.26.4',
                'lucide-react': '^0.546.0',
              },
              devDependencies: {
                '@capacitor/core': '6.2.0',
                '@capacitor/cli': '6.2.0',
                '@capacitor/android': '6.2.0',
                vite: '^8.3.0',
                typescript: '^7.0.2',
              },
            },
            null,
            2
          )
        );
        zip.file(
          'README.md',
          `# Pydroid 3 Web & Android APK Source Code\n\n## Hướng dẫn Build APK:\n1. Tải toàn bộ mã nguồn lên GitHub Repository của bạn.\n2. Vào tab Actions trên GitHub, kịch bản build-apk sẽ tự động chạy.\n3. Tải file app-debug.apk trong mục Artifacts về điện thoại và cài đặt!\n`
        );
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      triggerZipDownload(zipBlob, Math.round(zipBlob.size / 1024), defaultFilename);
    } catch (zipGenErr: any) {
      setDownloadError(zipGenErr?.message || 'Không thể tạo file zip. Vui lòng thử lại sau giây lát.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyWorkflow = () => {
    navigator.clipboard.writeText(workflowSnippet).then(() => {
      setCopiedWorkflow(true);
      setTimeout(() => setCopiedWorkflow(false), 2500);
    });
  };

  const activeUpdateFiles =
    updateScope === 'latest'
      ? exportInfo?.latestFiles || FALLBACK_LATEST_FILES
      : exportInfo?.updateFiles || FALLBACK_LATEST_FILES;
  const activeUpdateCount =
    updateScope === 'latest'
      ? exportInfo?.latestCount || FALLBACK_LATEST_FILES.length
      : exportInfo?.updateCount || FALLBACK_LATEST_FILES.length;
  const activeUpdateRawKb =
    updateScope === 'latest'
      ? exportInfo?.latestRawKb
      : exportInfo?.updateRawKb;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#181824] border-2 border-[#36354d] w-full max-w-xl max-h-[92vh] flex flex-col rounded-xl shadow-2xl overflow-hidden text-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#13131c] border-b border-[#2a293d] shrink-0">
          <div className="flex items-center space-x-2">
            <img
              src="/icon-512.png"
              alt="Pydroid 3 Android Icon"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg shadow border border-amber-400/40 object-cover shrink-0"
            />
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-1.5 flex-wrap">
                Đóng Gói File APK Android
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/50">
                  GITHUB ACTIONS
                </span>
              </h3>
              <p className="text-[11px] text-gray-400">
                Backend: <span className="font-mono text-cyan-300">tpydroid3-2.onrender.com</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#252438] rounded-lg text-gray-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="px-4 pt-2.5 pb-2 bg-[#14141f] border-b border-[#27263a] grid grid-cols-2 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('update');
              setDownloadError(null);
              setDownloadSuccess(null);
            }}
            className={`py-2 px-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTab === 'update'
                ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-sm'
                : 'bg-[#1a1a28] border-[#2c2b40] text-gray-400 hover:text-gray-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 shrink-0" />
            <span>Tải File Cập Nhật (.ZIP)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('full');
              setDownloadError(null);
              setDownloadSuccess(null);
            }}
            className={`py-2 px-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTab === 'full'
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-sm'
                : 'bg-[#1a1a28] border-[#2c2b40] text-gray-400 hover:text-gray-200'
            }`}
          >
            <Package className="w-3.5 h-3.5 shrink-0" />
            <span>Toàn Bộ Mã Nguồn</span>
          </button>
        </div>

        {/* Body Container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 touch-pan-y">
          {activeTab === 'update' ? (
            <>
              {/* Update-Only ZIP Card */}
              <div className="bg-gradient-to-br from-amber-950/45 via-[#1c1b29] to-[#131622] border-2 border-amber-400/55 rounded-xl p-3.5 sm:p-4 shadow-lg space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-amber-300 font-bold text-sm">
                      <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Chỉ Đóng Gói Các Tệp Cập Nhật (Siêu Nhẹ)</span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Giữ nguyên cấu trúc thư mục gốc (<code className="text-sky-300">src/</code>, <code className="text-sky-300">server.ts</code>, cấu hình) để bạn tải lên GitHub bằng <strong>GitHub Token</strong> đè thẳng các tệp đã sửa, bỏ qua ảnh/tài nguyên nặng không đổi.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchExportInfo}
                    disabled={isLoadingInfo}
                    className="p-1.5 rounded-lg bg-[#232236] hover:bg-[#2e2c47] text-amber-300 border border-amber-500/30 transition cursor-pointer shrink-0"
                    title="Làm mới danh sách tệp cập nhật"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingInfo ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {/* Scope selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUpdateScope('latest')}
                    className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                      updateScope === 'latest'
                        ? 'bg-amber-500/15 border-amber-400 text-amber-200'
                        : 'bg-[#12121d] border-[#29283e] text-gray-300 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold">⚡ Bản vá mới nhất</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-amber-300">
                        {exportInfo?.latestCount || FALLBACK_LATEST_FILES.length} tệp
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                      Chỉ gồm các tệp vừa cập nhật (tên miền Render mới, IME tiếng Việt APK, bộ xuất update...).
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUpdateScope('update')}
                    className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                      updateScope === 'update'
                        ? 'bg-cyan-500/15 border-cyan-400 text-cyan-200'
                        : 'bg-[#12121d] border-[#29283e] text-gray-300 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold">🧩 Toàn bộ code nhẹ</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-cyan-300">
                        {exportInfo?.updateCount || '...'} tệp
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                      Tất cả code <code className="text-cyan-300">src/</code>, <code className="text-cyan-300">server.ts</code> &amp; cấu hình, loại bỏ ảnh chụp nặng (~12MB).
                    </p>
                  </button>
                </div>

                {/* File Preview List */}
                <div className="bg-[#0e0e18] border border-[#2a2940] rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowFileList(!showFileList)}
                    className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-gray-200 hover:bg-[#161626] transition cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        Danh sách tệp trong gói ({activeUpdateCount} tệp
                        {activeUpdateRawKb ? ` • ~${activeUpdateRawKb} KB gốc` : ''})
                      </span>
                    </span>
                    {showFileList ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </button>

                  {showFileList && (
                    <div className="max-h-36 overflow-y-auto px-3 pb-2.5 pt-1 border-t border-[#222136] space-y-1 font-mono text-[10px] text-emerald-300">
                      {activeUpdateFiles.map((file) => (
                        <div key={file} className="truncate flex items-center gap-1.5">
                          <span className="text-amber-400">•</span>
                          <span>{file}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Download CTA */}
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => handleDownloadZip(updateScope)}
                    disabled={isDownloading}
                    className="w-full py-3 px-4 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 hover:from-amber-300 hover:to-orange-400 active:bg-amber-600 text-black font-black text-sm rounded-lg shadow-[0_3px_0_0_#78350f] active:translate-y-0.5 active:shadow-none transition flex items-center justify-center space-x-2 cursor-pointer border border-amber-200 disabled:opacity-60"
                  >
                    <Download className={`w-5 h-5 ${isDownloading ? 'animate-bounce' : ''}`} />
                    <span>
                      {isDownloading
                        ? 'Đang nén gói cập nhật...'
                        : updateScope === 'latest'
                        ? '📥 TẢI GÓI CẬP NHẬT MỚI NHẤT (.ZIP)'
                        : '📥 TẢI TOÀN BỘ CODE NHẸ (.ZIP)'}
                    </span>
                  </button>

                  <a
                    href={getApiUrl(`/api/project/export-zip?mode=${updateScope}`)}
                    download={
                      updateScope === 'latest'
                        ? 'pydroid3-latest-patch.zip'
                        : 'pydroid3-update-files.zip'
                    }
                    className="w-full py-1.5 px-3 bg-[#171624] hover:bg-[#212034] text-amber-300 rounded-lg text-[11px] font-bold border border-amber-500/30 flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Hoặc tải trực tiếp qua trình duyệt</span>
                  </a>
                </div>

                {downloadSuccess && (
                  <div className="p-2.5 bg-emerald-950/90 border border-emerald-400 text-emerald-200 text-xs rounded-lg flex items-center space-x-2 text-left animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-medium">{downloadSuccess}</span>
                  </div>
                )}

                {downloadError && (
                  <div className="p-2.5 bg-red-950/90 border border-red-400 text-red-200 text-xs rounded-lg flex items-center space-x-2 text-left animate-in fade-in">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="font-medium">Lỗi: {downloadError}</span>
                  </div>
                )}
              </div>

              {/* GitHub Token Sync Info */}
              <div className="p-3 bg-[#111c24] border border-cyan-500/40 rounded-xl flex items-start space-x-2.5 text-xs text-gray-300">
                <Globe className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-cyan-300">
                    Quy trình cập nhật nhanh bằng GitHub Token
                  </div>
                  <p className="text-[11px] text-gray-300 leading-relaxed">
                    1. Tải file <code className="text-amber-300">pydroid3-latest-patch.zip</code> (hoặc <code className="text-cyan-300">pydroid3-update-files.zip</code>) ở trên và giải nén.<br />
                    2. Dùng <strong>GitHub Token</strong> đẩy đè các tệp đó vào đúng đường dẫn trong repository GitHub hiện có.<br />
                    3. Render (<code className="text-emerald-300">tpydroid3-2.onrender.com</code>) sẽ tự deploy bản web mới, còn GitHub Actions sẽ tự build file <strong>.APK</strong> mới!
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* New Custom Android Icon Showcase */}
              <div className="bg-[#12121d] border border-amber-500/35 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md">
                <div className="flex items-center gap-3">
                  <div className="flex items-center -space-x-2 shrink-0">
                    <img
                      src="/icon-512.png"
                      alt="Icon Android Squircle"
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-[14px] border-2 border-amber-400/70 shadow-lg object-cover bg-[#171A2B]"
                      title="Hiển thị dạng bo góc Android"
                    />
                    <img
                      src="/icon-512.png"
                      alt="Icon Android Tròn"
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-full border-2 border-sky-400/70 shadow-lg object-cover bg-[#171A2B]"
                      title="Hiển thị dạng tròn (Pixel / Adaptive)"
                    />
                  </div>
                  <div className="space-y-0.5 text-left">
                    <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>Biểu Tượng Android Mới (Tự Động Tích Hợp)</span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-snug">
                      Đã tạo bộ icon chuẩn mọi độ phân giải (mdpi → xxxhdpi &amp; PWA 512px) sẵn sàng hiển thị trên màn hình chính điện thoại Android.
                    </p>
                  </div>
                </div>
                <a
                  href="/icon-512.png"
                  download="pydroid3-android-icon-512.png"
                  className="px-3 py-1.5 bg-[#232136] hover:bg-[#2f2c47] text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shrink-0 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Tải PNG (512px)</span>
                </a>
              </div>

              {/* Main Full Source Banner */}
              <div className="bg-gradient-to-br from-emerald-950/70 via-[#162722] to-[#121c22] border-2 border-emerald-500/60 rounded-xl p-3.5 sm:p-4 shadow-lg text-center space-y-2.5">
                <div className="flex items-center justify-center gap-2 text-emerald-300 font-bold text-sm">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>Gói mã nguồn đầy đủ (cài mới lần đầu)</span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed max-w-md mx-auto">
                  Bao gồm toàn bộ code ứng dụng, bộ icon Android, cấu hình Capacitor, Firebase (<code className="text-sky-300">{firebaseConfig.projectId}</code>) và kịch bản GitHub Actions.
                </p>

                <div className="space-y-1.5">
                  <button
                    onClick={() => handleDownloadZip('full')}
                    disabled={isDownloading}
                    className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 via-green-500 to-emerald-600 hover:from-emerald-400 hover:to-green-400 active:bg-emerald-700 text-black font-black text-sm rounded-lg shadow-[0_3px_0_0_#064e3b] active:translate-y-0.5 active:shadow-none transition flex items-center justify-center space-x-2 cursor-pointer border border-emerald-300"
                  >
                    <Download className={`w-5 h-5 ${isDownloading ? 'animate-bounce' : ''}`} />
                    <span>{isDownloading ? 'Đang chuẩn bị tệp tin...' : '📥 TẢI TOÀN BỘ MÃ NGUỒN (.ZIP) VỀ MÁY'}</span>
                  </button>

                  <a
                    href={getApiUrl('/api/project/export-zip?mode=full')}
                    download="pydroid3-source-code.zip"
                    className="w-full py-1.5 px-3 bg-[#111e17] hover:bg-[#182b21] text-emerald-400 hover:text-emerald-300 rounded-lg text-[11px] font-bold border border-emerald-500/30 flex items-center justify-center space-x-1.5 transition cursor-pointer"
                    title="Tải trực tiếp qua trình duyệt tải về mặc định"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Hoặc bấm vào đây để tải trực tiếp qua trình duyệt</span>
                  </a>
                </div>

                {downloadSuccess && (
                  <div className="p-2.5 bg-emerald-950/90 border border-emerald-400 text-emerald-200 text-xs rounded-lg flex items-center space-x-2 text-left animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-medium">{downloadSuccess}</span>
                  </div>
                )}

                {downloadError && (
                  <div className="p-2.5 bg-red-950/90 border border-red-400 text-red-200 text-xs rounded-lg flex items-center space-x-2 text-left animate-in fade-in">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="font-medium">Lỗi: {downloadError}</span>
                  </div>
                )}
              </div>

              {/* Cloud Services Banner */}
              <div className="p-3 bg-[#111c24] border border-cyan-500/40 rounded-xl flex items-start space-x-2.5 text-xs text-gray-300">
                <Globe className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-cyan-300">Đồng bộ Google Drive &amp; Cloud Backend trên APK</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-bold">
                      ĐỒNG BỘ
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    Bản APK tự động trỏ về máy chủ <code className="text-cyan-300">{RENDER_CLOUD_API_URL}</code>. Để đăng nhập Google &amp; đồng bộ Google Drive, bạn mở địa chỉ web trên Chrome hoặc cấu hình URL backend trong <strong className="text-amber-300">Cài đặt ⚙</strong>.
                  </p>
                </div>
              </div>

              {/* Stepper Guide */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  <span>Quy trình 4 bước tạo APK trên điện thoại (Không cần máy tính)</span>
                </h4>

                <div
                  onClick={() => setActiveStep(1)}
                  className={`p-3 rounded-lg border transition cursor-pointer ${
                    activeStep === 1
                      ? 'bg-[#1e1e2f] border-emerald-500/60 shadow-md'
                      : 'bg-[#151520] border-[#2c2b3f] hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center shrink-0 border border-emerald-500/40">
                      1
                    </span>
                    <div className="space-y-1 text-xs">
                      <p className="font-bold text-white">Tải mã nguồn về máy và giải nén</p>
                      <p className="text-gray-300">
                        Lần đầu tạo repo thì tải <code className="bg-black/50 px-1 py-0.5 rounded text-amber-300">pydroid3-source-code.zip</code>; các lần sau chỉ cần dùng tab <strong>Tải File Cập Nhật</strong> cho nhẹ.
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setActiveStep(2)}
                  className={`p-3 rounded-lg border transition cursor-pointer ${
                    activeStep === 2
                      ? 'bg-[#1e1e2f] border-emerald-500/60 shadow-md'
                      : 'bg-[#151520] border-[#2c2b3f] hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-500/40">
                      2
                    </span>
                    <div className="space-y-1.5 text-xs">
                      <p className="font-bold text-white">Tạo Repository trên GitHub</p>
                      <p className="text-gray-300 leading-relaxed">
                        Mở <strong className="text-sky-300">github.com</strong> ➔ Bấm <strong>New</strong> ➔ Đặt tên (ví dụ: <code className="text-amber-300">pydroid3-app</code>) ➔ Chọn <strong>Public</strong> ➔ <strong>Create repository</strong>.
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setActiveStep(3)}
                  className={`p-3 rounded-lg border transition cursor-pointer ${
                    activeStep === 3
                      ? 'bg-[#1e1e2f] border-emerald-500/60 shadow-md'
                      : 'bg-[#151520] border-[#2c2b3f] hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 font-bold text-xs flex items-center justify-center shrink-0 border border-purple-500/40">
                      3
                    </span>
                    <div className="space-y-1.5 text-xs">
                      <p className="font-bold text-white">Đẩy mã nguồn lên GitHub</p>
                      <p className="text-gray-300 leading-relaxed">
                        Tải toàn bộ tệp đã giải nén (gồm <code className="text-amber-300">.github</code>, <code className="text-amber-300">src</code>, <code className="text-amber-300">package.json</code>) lên GitHub hoặc dùng GitHub Token để push trực tiếp.
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setActiveStep(4)}
                  className={`p-3 rounded-lg border transition cursor-pointer ${
                    activeStep === 4
                      ? 'bg-[#1e1e2f] border-emerald-500/60 shadow-md'
                      : 'bg-[#151520] border-[#2c2b3f] hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center shrink-0 border border-amber-500/40">
                      4
                    </span>
                    <div className="space-y-1.5 text-xs">
                      <p className="font-bold text-white">Tải file APK trong mục Actions</p>
                      <p className="text-gray-300 leading-relaxed">
                        Vào tab <strong>Actions</strong> ➔ chờ <strong>Build Android APK</strong> báo tích xanh ✓ ➔ tải <strong>Pydroid3-Android-APK</strong> trong mục <strong>Artifacts</strong> về cài đặt!
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick PWA Alternative */}
              <div className="bg-[#121c16] border border-emerald-600/40 rounded-xl p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Mẹo cài nhanh dùng ngay (Không cần build APK):</span>
                </div>
                <p className="text-gray-300 leading-relaxed">
                  Mở <code className="text-sky-300">{RENDER_CLOUD_API_URL}</code> trên Chrome điện thoại ➔ Menu <strong>3 chấm ⋮</strong> ➔ Chọn <strong>"Cài đặt ứng dụng"</strong> để dùng toàn màn hình như app Android!
                </p>
              </div>

              {/* Workflow Code Snippet */}
              <div className="bg-[#12121c] border border-[#26253a] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-gray-300 flex items-center gap-1">
                    <FileCode className="w-3.5 h-3.5 text-sky-400" />
                    <span>Kịch bản GitHub Actions (.github/workflows/build-apk.yml)</span>
                  </span>
                  <button
                    onClick={handleCopyWorkflow}
                    className="px-2 py-1 bg-[#202030] hover:bg-[#2b2b40] rounded text-[11px] font-bold text-amber-300 flex items-center gap-1 transition cursor-pointer"
                  >
                    {copiedWorkflow ? (
                      <>
                        <Check className="w-3 h-3 text-green-400" />
                        <span>Đã sao chép!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Sao chép mã</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="text-[10px] text-gray-400 bg-black/60 p-2.5 rounded font-mono overflow-x-auto max-h-32 border border-[#212033]">
                  {workflowSnippet}
                </pre>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#13131c] border-t border-[#2a293d] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-gray-400">
            Hỗ trợ Android 8.0 trở lên • ARM64 &amp; x86_64
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-[#252438] hover:bg-[#32314d] text-white rounded-lg text-xs font-bold transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

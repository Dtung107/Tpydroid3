import React, { useEffect, useMemo, useState } from 'react';
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
  FolderArchive,
  Sliders,
  FileText,
} from 'lucide-react';
import JSZip from 'jszip';
import { getApiBaseUrl, getApiUrl, RENDER_CLOUD_API_URL } from '../utils/apiConfig';
import { SavedFile } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';

interface ExportApkModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCode?: string;
  currentFileName?: string;
  savedFiles?: SavedFile[];
  defaultTemplateCode?: string;
}

type ExportTab = 'jszip' | 'update' | 'full';
type UpdateScope = 'latest' | 'update';

interface ExportInfoData {
  latestCount: number;
  latestFiles: string[];
  latestRawKb: number;
  updateCount: number;
  updateFiles: string[];
  updateRawKb: number;
}

interface CollectedZipEntry {
  path: string;
  content: string;
  category: 'py' | 'config';
  isChanged: boolean;
  reason: string;
  sizeBytes: number;
}

const FALLBACK_LATEST_FILES = [
  'src/utils/apiConfig.ts',
  'src/utils/googleAuth.ts',
  'src/utils/linter.ts',
  'src/components/SettingsModal.tsx',
  'src/components/ExportApkModal.tsx',
  'src/components/ApkOAuthBridge.tsx',
  'src/components/Editor.tsx',
  'src/components/Terminal.tsx',
  'src/components/AiAssistantModal.tsx',
  'src/App.tsx',
  'src/main.tsx',
  'index.html',
  'server.ts',
  'firebase-applet-config.json',
  'capacitor.config.json',
  '.github/workflows/build-apk.yml',
];

const WORKFLOW_SNIPPET = `name: Build Android APK for Pydroid 3 Web
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
      - run: npm install --legacy-peer-deps --save-exact @capacitor/core@6.2.0 @capacitor/cli@6.2.0 @capacitor/android@6.2.0 @capacitor/browser@6.0.6 @capacitor/app@6.0.3
      - run: npm run build
      - run: npx cap add android || true
      - name: Add OAuth Deep Link Intent Filter
        run: |
          python3 - << 'PYEOF'
          import os
          p = "android/app/src/main/AndroidManifest.xml"
          if os.path.exists(p):
              s = open(p, encoding="utf-8").read()
              if "</activity>" in s and 'android:scheme="com.pydroid3.webide"' not in s:
                  intent = '<intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="com.pydroid3.webide" android:host="oauth"/></intent-filter></activity>'
                  open(p, "w", encoding="utf-8").write(s.replace("</activity>", intent, 1))
          PYEOF
      - run: if [ -d "resources/android-res" ]; then cp -rf resources/android-res/* android/app/src/main/res/; fi
      - run: npx cap sync android
      - run: cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon --stacktrace
      - uses: actions/upload-artifact@v4
        with:
          name: Pydroid3-Android-APK
          path: android/app/build/outputs/apk/debug/app-debug.apk`;

function sanitizePyFileName(rawName: string): string {
  const trimmed = (rawName || 'main.py').trim().replace(/\\/g, '/');
  const base = trimmed.split('/').pop() || 'main.py';
  const clean = base.replace(/[^a-zA-Z0-9._\-]/g, '_');
  return clean.endsWith('.py') ? clean : `${clean}.py`;
}

function getUtf8ByteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch (_) {
    return text.length;
  }
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (_) {
    return fallback;
  }
}

function collectChangedPyAndConfigEntries(options: {
  currentCode?: string;
  currentFileName?: string;
  savedFiles?: SavedFile[];
  defaultTemplateCode?: string;
}): CollectedZipEntry[] {
  const entries: CollectedZipEntry[] = [];
  const seenPaths = new Set<string>();

  const activeName = sanitizePyFileName(options.currentFileName || 'main.py');
  const activeCode =
    options.currentCode !== undefined
      ? options.currentCode
      : typeof window !== 'undefined'
      ? localStorage.getItem('pydroid_current_code') || ''
      : '';

  const storedSavedFiles: SavedFile[] =
    options.savedFiles && options.savedFiles.length >= 0
      ? options.savedFiles
      : typeof window !== 'undefined'
      ? safeParseJson<SavedFile[]>(localStorage.getItem('pydroid_saved_files'), [])
      : [];

  const matchingSaved = storedSavedFiles.find(
    (f) => sanitizePyFileName(f.name) === activeName
  );
  const activeChangedVsTemplate =
    Boolean(activeCode.trim()) &&
    (options.defaultTemplateCode === undefined || activeCode !== options.defaultTemplateCode);
  const activeChangedVsSaved = matchingSaved ? activeCode !== matchingSaved.code : activeChangedVsTemplate;

  if (activeCode.trim()) {
    seenPaths.add(activeName);
    entries.push({
      path: activeName,
      content: activeCode,
      category: 'py',
      isChanged: activeChangedVsTemplate || activeChangedVsSaved,
      reason: activeChangedVsSaved
        ? 'File đang mở đã chỉnh sửa'
        : activeChangedVsTemplate
        ? 'Code hiện tại khác mẫu gốc'
        : 'File mặc định đang mở',
      sizeBytes: getUtf8ByteLength(activeCode),
    });
  }

  // Collect saved .py scripts sorted newest first
  const sortedSaved = [...storedSavedFiles].sort(
    (a, b) => (b.lastModified || 0) - (a.lastModified || 0)
  );
  for (const file of sortedSaved) {
    const cleanName = sanitizePyFileName(file.name);
    const targetPath = seenPaths.has(cleanName) ? `scripts/${cleanName}` : cleanName;
    if (seenPaths.has(targetPath)) continue;
    // Skip duplicate if exact same name and content already added as active
    if (cleanName === activeName && file.code === activeCode) continue;

    seenPaths.add(targetPath);
    entries.push({
      path: targetPath,
      content: file.code || '',
      category: 'py',
      isChanged: true,
      reason: 'Tệp .py đã lưu thay đổi',
      sizeBytes: getUtf8ByteLength(file.code || ''),
    });
  }

  // Config 1: capacitor.config.json
  const capacitorContent = JSON.stringify(
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
  );
  entries.push({
    path: 'capacitor.config.json',
    content: capacitorContent,
    category: 'config',
    isChanged: true,
    reason: 'Cấu hình đóng gói Android Capacitor',
    sizeBytes: getUtf8ByteLength(capacitorContent),
  });

  // Config 2: firebase-applet-config.json
  const firebaseContent = JSON.stringify(firebaseConfig, null, 2);
  entries.push({
    path: 'firebase-applet-config.json',
    content: firebaseContent,
    category: 'config',
    isChanged: true,
    reason: 'Cấu hình xác thực Google / Firebase',
    sizeBytes: getUtf8ByteLength(firebaseContent),
  });

  // Config 3: .github/workflows/build-apk.yml
  entries.push({
    path: '.github/workflows/build-apk.yml',
    content: WORKFLOW_SNIPPET,
    category: 'config',
    isChanged: true,
    reason: 'Kịch bản GitHub Actions build APK',
    sizeBytes: getUtf8ByteLength(WORKFLOW_SNIPPET),
  });

  // Config 4: pydroid-config.json (sanitized IDE & gateway preferences, strictly NO secrets)
  if (typeof window !== 'undefined') {
    const ideConfig = {
      appVersion: '3.0.0',
      exportedAt: new Date().toISOString(),
      backendGatewayUrl: getApiBaseUrl() || RENDER_CLOUD_API_URL,
      engine: localStorage.getItem('pydroid_engine') || 'cpython',
      fontSize: Number(localStorage.getItem('pydroid_font_size')) || 15,
      fontFamily: localStorage.getItem('pydroid_font_family') || "'JetBrains Mono', monospace",
      indentSpaces: Number(localStorage.getItem('pydroid_indent_spaces')) || 4,
      theme: localStorage.getItem('pydroid_theme') || 'pydroid-dark',
      linterEnabled: localStorage.getItem('pydroid_linter_enabled') !== 'false',
      keySize: localStorage.getItem('pydroid_key_size') || 'medium',
      customColors: safeParseJson<Record<string, string> | null>(
        localStorage.getItem('pydroid_custom_colors'),
        null
      ),
      customKeys: safeParseJson<Array<Record<string, unknown>> | null>(
        localStorage.getItem('pydroid_keys'),
        null
      ),
    };
    const ideConfigContent = JSON.stringify(ideConfig, null, 2);
    entries.push({
      path: 'pydroid-config.json',
      content: ideConfigContent,
      category: 'config',
      isChanged: true,
      reason: 'Cấu hình IDE, giao diện & Backend URL',
      sizeBytes: getUtf8ByteLength(ideConfigContent),
    });

    // Config 5: requirements.txt (if installed Python packages exist)
    const installedPkgs = safeParseJson<Array<{ name: string; version?: string }>>(
      localStorage.getItem('pydroid3_installed_packages'),
      []
    );
    if (Array.isArray(installedPkgs) && installedPkgs.length > 0) {
      const reqLines = installedPkgs
        .filter((p) => p && typeof p.name === 'string' && /^[a-zA-Z0-9._-]+$/.test(p.name))
        .map((p) =>
          p.version && p.version !== 'installed' && p.version !== 'đã cài đặt'
            ? `${p.name}==${p.version}`
            : p.name
        );
      if (reqLines.length > 0) {
        const reqContent = reqLines.join('\n') + '\n';
        entries.push({
          path: 'requirements.txt',
          content: reqContent,
          category: 'config',
          isChanged: true,
          reason: `Danh sách ${reqLines.length} thư viện Pip đã cài`,
          sizeBytes: getUtf8ByteLength(reqContent),
        });
      }
    }
  }

  return entries;
}

export const ExportApkModal: React.FC<ExportApkModalProps> = ({
  isOpen,
  onClose,
  currentCode,
  currentFileName,
  savedFiles,
  defaultTemplateCode,
}) => {
  const [activeTab, setActiveTab] = useState<ExportTab>('jszip');
  const [updateScope, setUpdateScope] = useState<UpdateScope>('latest');
  const [showFileList, setShowFileList] = useState<boolean>(true);
  const [exportInfo, setExportInfo] = useState<ExportInfoData | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState<boolean>(false);

  // JSZip selective state
  const [onlyChangedFilter, setOnlyChangedFilter] = useState<boolean>(true);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const [copiedWorkflow, setCopiedWorkflow] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [activeStep, setActiveStep] = useState<number>(1);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  const collectedEntries = useMemo(() => {
    if (!isOpen) return [];
    return collectChangedPyAndConfigEntries({
      currentCode,
      currentFileName,
      savedFiles,
      defaultTemplateCode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentCode, currentFileName, savedFiles, defaultTemplateCode, refreshTick]);

  const displayedEntries = useMemo(() => {
    if (!onlyChangedFilter) return collectedEntries;
    return collectedEntries.filter((e) => e.isChanged || e.category === 'config');
  }, [collectedEntries, onlyChangedFilter]);

  useEffect(() => {
    if (isOpen) {
      const defaults = new Set(
        displayedEntries.filter((e) => e.isChanged || e.category === 'config').map((e) => e.path)
      );
      setSelectedPaths(defaults);
    }
  }, [isOpen, displayedEntries]);

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
      `Đã nén và tải thành công ${filename}${countText} • ${Math.max(1, kbSize)} KB!`
    );
  };

  const handleGenerateJSZipPackage = async () => {
    const entriesToZip = displayedEntries.filter((e) => selectedPaths.has(e.path));
    if (entriesToZip.length === 0) {
      setDownloadError('Vui lòng chọn ít nhất 1 tệp .py hoặc tệp cấu hình để nén.');
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(null);

    try {
      const zip = new JSZip();

      for (const entry of entriesToZip) {
        zip.file(entry.path, entry.content);
      }

      // Include concise update manifest inside ZIP for traceability
      zip.file(
        'update-manifest.json',
        JSON.stringify(
          {
            generatedBy: 'Pydroid 3 JSZip Export Utility',
            generatedAt: new Date().toISOString(),
            fileCount: entriesToZip.length,
            files: entriesToZip.map((e) => ({
              path: e.path,
              category: e.category,
              isChanged: e.isChanged,
              sizeBytes: e.sizeBytes,
            })),
          },
          null,
          2
        )
      );

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      const kbSize = Math.max(1, Math.round(zipBlob.size / 1024));
      triggerZipDownload(
        zipBlob,
        kbSize,
        'pydroid3-py-config-update.zip',
        entriesToZip.length + 1
      );
    } catch (err: any) {
      setDownloadError(err?.message || 'Lỗi khi nén tệp bằng JSZip. Vui lòng thử lại.');
    } finally {
      setIsDownloading(false);
    }
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

    // Tier 3: On-Device JSZip Fallback
    try {
      const zip = new JSZip();
      for (const entry of collectedEntries) {
        zip.file(entry.path, entry.content);
      }

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
          `# Pydroid 3 Web & Android APK Source Code\n\n## Hướng dẫn Build APK:\n1. Tải mã nguồn lên GitHub Repository của bạn.\n2. Vào tab Actions trên GitHub, kịch bản build-apk sẽ tự động chạy.\n3. Tải file app-debug.apk trong mục Artifacts về điện thoại và cài đặt!\n`
        );
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      triggerZipDownload(zipBlob, Math.round(zipBlob.size / 1024), defaultFilename);
    } catch (zipGenErr: any) {
      setDownloadError(zipGenErr?.message || 'Không thể tạo file zip. Vui lòng thử lại sau giây lát.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyWorkflow = () => {
    navigator.clipboard.writeText(WORKFLOW_SNIPPET).then(() => {
      setCopiedWorkflow(true);
      setTimeout(() => setCopiedWorkflow(false), 2500);
    });
  };

  const toggleEntryPath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectedEntriesList = displayedEntries.filter((e) => selectedPaths.has(e.path));
  const selectedRawBytes = selectedEntriesList.reduce((sum, e) => sum + e.sizeBytes, 0);
  const selectedPyCount = selectedEntriesList.filter((e) => e.category === 'py').length;
  const selectedConfigCount = selectedEntriesList.filter((e) => e.category === 'config').length;

  const activeUpdateFiles =
    updateScope === 'latest'
      ? exportInfo?.latestFiles || FALLBACK_LATEST_FILES
      : exportInfo?.updateFiles || FALLBACK_LATEST_FILES;
  const activeUpdateCount =
    updateScope === 'latest'
      ? exportInfo?.latestCount || FALLBACK_LATEST_FILES.length
      : exportInfo?.updateCount || FALLBACK_LATEST_FILES.length;
  const activeUpdateRawKb =
    updateScope === 'latest' ? exportInfo?.latestRawKb : exportInfo?.updateRawKb;

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
                Đóng Gói &amp; Cập Nhật Ứng Dụng
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/50">
                  JSZIP THÔNG MINH
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
        <div className="px-3 sm:px-4 pt-2.5 pb-2 bg-[#14141f] border-b border-[#27263a] grid grid-cols-3 gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('jszip');
              setDownloadError(null);
              setDownloadSuccess(null);
            }}
            className={`py-2 px-2 rounded-lg border text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
              activeTab === 'jszip'
                ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-sm'
                : 'bg-[#1a1a28] border-[#2c2b40] text-gray-400 hover:text-gray-200'
            }`}
          >
            <FolderArchive className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">JSZip (.py &amp; Config)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('update');
              setDownloadError(null);
              setDownloadSuccess(null);
            }}
            className={`py-2 px-2 rounded-lg border text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
              activeTab === 'update'
                ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-sm'
                : 'bg-[#1a1a28] border-[#2c2b40] text-gray-400 hover:text-gray-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Vá Mã Nguồn</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('full');
              setDownloadError(null);
              setDownloadSuccess(null);
            }}
            className={`py-2 px-2 rounded-lg border text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
              activeTab === 'full'
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-sm'
                : 'bg-[#1a1a28] border-[#2c2b40] text-gray-400 hover:text-gray-200'
            }`}
          >
            <Package className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Toàn Bộ Dự Án</span>
          </button>
        </div>

        {/* Body Container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 touch-pan-y">
          {activeTab === 'jszip' ? (
            <>
              <div className="bg-gradient-to-br from-sky-950/50 via-[#171b2b] to-[#121622] border-2 border-sky-400/55 rounded-xl p-3.5 sm:p-4 shadow-lg space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-sky-300 font-bold text-sm">
                      <FolderArchive className="w-4 h-4 text-sky-400 shrink-0" />
                      <span>Tự Động Thu Thập .py &amp; Cấu Hình Bằng JSZip</span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Nén trực tiếp trên thiết bị các tệp <code className="text-emerald-300">.py</code> đã thay đổi và tệp cấu hình (Capacitor, Firebase, Workflow APK, IDE Config, Pip) thành 1 file <code className="text-sky-300">.zip</code> gọn nhẹ, không tải toàn bộ thư mục dự án.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRefreshTick((t) => t + 1)}
                    className="p-1.5 rounded-lg bg-[#202438] hover:bg-[#2b304a] text-sky-300 border border-sky-500/30 transition cursor-pointer shrink-0"
                    title="Quét lại các tệp .py và cấu hình"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Filter & quick stats */}
                <div className="flex items-center justify-between flex-wrap gap-2 p-2 rounded-lg bg-[#0f1320] border border-[#262d47] text-[11px]">
                  <label className="flex items-center gap-2 cursor-pointer text-gray-200 select-none">
                    <input
                      type="checkbox"
                      checked={onlyChangedFilter}
                      onChange={(e) => setOnlyChangedFilter(e.target.checked)}
                      className="accent-sky-400 rounded cursor-pointer"
                    />
                    <span>Chỉ hiện file .py đã sửa &amp; cấu hình</span>
                  </label>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      {selectedPyCount} .py
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {selectedConfigCount} cấu hình
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                      ~{Math.max(1, Math.round(selectedRawBytes / 1024))} KB
                    </span>
                  </div>
                </div>

                {/* Selectable File List */}
                <div className="bg-[#0c0e18] border border-[#252940] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-[#121524] border-b border-[#22263b] flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-gray-200 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-sky-400" />
                      <span>
                        Tệp thu thập được ({selectedEntriesList.length}/{displayedEntries.length})
                      </span>
                    </span>
                    <div className="flex items-center gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedPaths(new Set(displayedEntries.map((e) => e.path)))
                        }
                        className="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                      >
                        Chọn tất cả
                      </button>
                      <span className="text-gray-600">•</span>
                      <button
                        type="button"
                        onClick={() => setSelectedPaths(new Set())}
                        className="text-gray-400 hover:text-gray-200 font-semibold cursor-pointer"
                      >
                        Bỏ chọn
                      </button>
                    </div>
                  </div>

                  <div className="max-h-52 overflow-y-auto divide-y divide-[#1b1f33]">
                    {displayedEntries.length === 0 ? (
                      <div className="p-4 text-center text-xs text-gray-400">
                        Chưa phát hiện file .py nào thay đổi so với mẫu gốc. Bỏ tích bộ lọc phía trên để chọn cả file mặc định.
                      </div>
                    ) : (
                      displayedEntries.map((entry) => {
                        const checked = selectedPaths.has(entry.path);
                        return (
                          <label
                            key={entry.path}
                            className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#141829] transition cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleEntryPath(entry.path)}
                                className="accent-sky-400 shrink-0 cursor-pointer"
                              />
                              {entry.category === 'py' ? (
                                <FileCode className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="font-mono text-[11px] text-gray-100 truncate">
                                  {entry.path}
                                </div>
                                <div className="text-[10px] text-gray-400 truncate">
                                  {entry.reason}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {entry.category === 'py' && entry.isChanged && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  Đã sửa
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-gray-400">
                                {entry.sizeBytes >= 1024
                                  ? `${(entry.sizeBytes / 1024).toFixed(1)} KB`
                                  : `${entry.sizeBytes} B`}
                              </span>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Generate with JSZip button */}
                <button
                  type="button"
                  onClick={handleGenerateJSZipPackage}
                  disabled={isDownloading || selectedEntriesList.length === 0}
                  className="w-full py-3 px-4 bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-400 hover:from-sky-300 hover:to-emerald-300 active:bg-sky-600 text-black font-black text-sm rounded-lg shadow-[0_3px_0_0_#075985] active:translate-y-0.5 active:shadow-none transition flex items-center justify-center space-x-2 cursor-pointer border border-sky-200 disabled:opacity-50"
                >
                  <Download className={`w-5 h-5 ${isDownloading ? 'animate-bounce' : ''}`} />
                  <span>
                    {isDownloading
                      ? 'Đang nén bằng JSZip...'
                      : `📦 NÉN & TẢI (${selectedEntriesList.length} TỆP) BẰNG JSZIP`}
                  </span>
                </button>

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

              <div className="p-3 bg-[#111c24] border border-cyan-500/40 rounded-xl flex items-start space-x-2.5 text-xs text-gray-300">
                <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-cyan-300">
                    Hoạt động 100% trực tiếp trong ứng dụng (Không cần mạng)
                  </div>
                  <p className="text-[11px] text-gray-300 leading-relaxed">
                    Tệp <code className="text-sky-300">pydroid3-py-config-update.zip</code> được nén ngay trên thiết bị bằng <strong>JSZip</strong> kèm file <code className="text-amber-300">update-manifest.json</code>. Nếu bạn cần lấy thêm file mã nguồn React/Server đã vá để đẩy qua GitHub Token, hãy chuyển sang tab <strong>⚡ Vá Mã Nguồn</strong>.
                  </p>
                </div>
              </div>
            </>
          ) : activeTab === 'update' ? (
            <>
              {/* Server Update-Only ZIP Card */}
              <div className="bg-gradient-to-br from-amber-950/45 via-[#1c1b29] to-[#131622] border-2 border-amber-400/55 rounded-xl p-3.5 sm:p-4 shadow-lg space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-amber-300 font-bold text-sm">
                      <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Chỉ Đóng Gói Các Tệp Mã Nguồn Cập Nhật</span>
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
                      Chỉ gồm các tệp vừa cập nhật (Render mới, IME tiếng Việt APK, workflow JDK 17...).
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
                        Lần đầu tạo repo thì tải <code className="bg-black/50 px-1 py-0.5 rounded text-amber-300">pydroid3-source-code.zip</code>; các lần sau chỉ cần dùng tab <strong>JSZip</strong> hoặc <strong>Vá Mã Nguồn</strong> cho nhẹ.
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
                  {WORKFLOW_SNIPPET}
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
